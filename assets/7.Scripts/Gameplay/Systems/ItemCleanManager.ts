import { _decorator, Component, Enum, Node, Tween, tween, Vec3 } from 'cc';
import type { CloudEffect } from '../Effects/CloudEffect';
import type { Item } from '../Items/Components/Item';
import type { CleanItem } from '../Cleaning/CleanItem';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
import { ipm } from '../../Core/Managers/InputManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { HandTutManager } from './HandTutManager';

const { ccclass, property } = _decorator;

export enum CleanItemDisplayMode {
    /** Hiện từng item một; item lau xong thì thu nhỏ biến mất rồi item kế tiếp hiện ra. */
    Sequential = 0,
    /** Hiện sẵn toàn bộ item ngay từ đầu; item lau xong vẫn nằm nguyên trên màn hình. */
    ShowAll = 1,
}
Enum(CleanItemDisplayMode);

/**
 * Drives the cleaning items. Call ItemCleanDone() when the current item has been
 * cleaned to advance to the next configured item.
 *
 * Both display modes walk `items` in the same order and fire onAllItemsCleaned
 * after the last one; they only differ in whether items are shown one at a time
 * (Sequential) or all at once and left on screen when finished (ShowAll).
 */
@ccclass('ItemCleanManager')
export class ItemCleanManager extends Ply_Singleton<ItemCleanManager> {
    // Do not reference Item here. Item imports this manager, so that would
    // create a runtime circular import in Cocos' scene script loader.
    @property([Component])
    public items: Component[] = [];

    @property({ tooltip: 'Show the first item automatically when this manager starts.' })
    public autoStart = true;

    @property({
        type: Enum(CleanItemDisplayMode),
        tooltip: 'Sequential: hiện lần lượt, lau xong item nào thì item đó biến mất. ShowAll: hiện sẵn tất cả item, lau xong vẫn giữ nguyên trên màn hình. Cả hai đều đi theo đúng thứ tự trong mảng items'
    })
    public displayMode: CleanItemDisplayMode = CleanItemDisplayMode.Sequential;

    @property({ tooltip: 'Chỉ dùng cho ShowAll: component nào tự khai báo SetInteractable() (hiện tại là TrashBin) thì bị khoá tương tác cho tới đúng lượt của nó. Các item còn lại luôn tương tác được' })
    public gateInteractableItemsByTurn = true;


    @property({ min: 0.01, tooltip: 'Zoom duration used when an item appears or disappears.' })
    public zoomDuration = 0.25;

    @property({ tooltip: 'Spawn a cloud effect when the next cleaning item appears.' })
    public spawnCloudOnItemShow = true;

    @property({ tooltip: 'Register each shown item with HandTutManager so it gets a hand hint after handTutDelay.' })
    public enableHandTut = true;

    @property({ min: 0, tooltip: 'Seconds the player can idle on the current item before the hand hint appears (overrides HandTutManager delays).' })
    public handTutDelay = 5;

    @property({ tooltip: 'Move and zoom InputManager screenTarget after all cleaning items are complete.' })
    public moveScreenTargetOnComplete = false;

    @property({ type: Vec3, tooltip: 'screenTarget local position after all cleaning items are complete.' })
    public completedScreenTargetPosition = new Vec3();

    @property({ tooltip: 'screenTarget uniform scale after all cleaning items are complete.' })
    public completedScreenTargetScale = 1;

    @property({ min: 0.01, tooltip: 'Seconds used to move and zoom screenTarget after completion.' })
    public completedScreenTargetDuration = 0.5;

    @property({ type: Ply_Event, tooltip: 'Called after the final item has disappeared.' })
    public onAllItemsCleaned: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Called after the final screen-target transition has completed.' })
    public onCompleteScreen: Ply_Event = new Ply_Event();

    @property({ readonly: true, tooltip: 'Index of the item currently being cleaned (-1 when idle/complete).' })
    public currentItemIndex = -1;

    private readonly itemScales = new Map<Component, Vec3>();
    private activeTween: Tween<Node> | null = null;
    private completedScreenTargetTween: Tween<Node> | null = null;
    private isTransitioning = false;
    private hasCompletedSequence = false;

    protected onLoad(): void {
        super.onLoad();
        this.cacheItemScales();
        this.setAllItemsInactive();

        // Khoá ngay từ onLoad chứ không đợi RevealAllItems() trong start(): node trash nằm ngoài
        // mảng `items` nên setAllItemsInactive() không đụng tới, chúng vẫn active và kéo được
        // trong quãng giữa lúc scene load xong và lúc start() chạy.
        this.applyTurnGate();
    }

    protected start(): void {
        if (this.autoStart) this.StartItems();
    }

    protected onDisable(): void {
        this.stopActiveTween();
        this.isTransitioning = false;
    }

    /** Restarts the sequence from its first configured item. */
    public StartItems(): void {
        this.stopActiveTween();
        this.cacheItemScales();
        this.setAllItemsInactive();
        this.currentItemIndex = -1;
        this.isTransitioning = false;
        this.hasCompletedSequence = false;

        if (this.displayMode === CleanItemDisplayMode.ShowAll) {
            this.RevealAllItems();
        }

        this.ShowNextItem();
    }

    /** ShowAll: bung toàn bộ item cùng lúc, mỗi item vẫn có hiệu ứng zoom + cloud như cũ. */
    private RevealAllItems(): void {
        let hasRevealedAny = false;

        for (const item of this.items) {
            if (!item || !item.isValid) continue;

            const targetScale = this.getItemScale(item);
            item.node.active = true;
            item.node.setScale(this.getZeroScale(item));
            this.SpawnItemShowCloud(item);

            // Tween riêng cho từng node, không giữ vào activeTween (chỗ đó chỉ chứa được 1 tween).
            // setAllItemsInactive() đã Tween.stopAllByTarget từng node nên không sợ chồng tween.
            tween(item.node)
                .to(this.zoomDuration, { scale: targetScale }, { easing: 'backOut' })
                .start();

            hasRevealedAny = true;
        }

        // Một tiếng cho cả đợt, thay vì N tiếng chồng lên nhau.
        if (hasRevealedAny) Ply_SoundManager.Ins?.PlayFx(FxType.CleanItemAppear);

        // currentItemIndex vẫn là -1 ở đây nên gate khoá sạch; ShowNextItem() ngay sau đó
        // set lại index rồi mở khoá đúng item của lượt đầu tiên.
        this.applyTurnGate();
    }

    /**
     * Khoá / mở khoá tương tác cho một item của danh sách. Cố ý chỉ đụng tới component nào tự
     * khai báo SetInteractable() - hiện chỉ TrashBin, nơi việc dọn rác sớm sẽ phá vỡ thứ tự lượt.
     * Các item khác (CleanItem...) không bị khoá: lau sớm một item không gây hỏng chuỗi vì
     * shouldSkipItem() đã bỏ qua item đã sạch khi chuyển lượt.
     */
    private setItemInteractable(item: Component, interactable: boolean): void {
        if (!this.gateInteractableItemsByTurn || !item?.isValid) return;

        const gated = item as unknown as { SetInteractable?: (value: boolean) => void };
        gated.SetInteractable?.(interactable);
    }

    /**
     * Đặt lại trạng thái tương tác cho TOÀN BỘ danh sách theo currentItemIndex, thay vì chỉ đụng
     * vào item vừa đổi lượt. Một lần chuyển lượt bị hụt - StartItems() gọi lại, item bị
     * shouldSkipItem() nhảy qua, ItemCleanDone() bắn hai lần - sẽ tự được sửa ở lần gọi kế tiếp
     * thay vì để một item kẹt khoá vĩnh viễn.
     */
    private applyTurnGate(): void {
        if (!this.gateInteractableItemsByTurn || this.displayMode !== CleanItemDisplayMode.ShowAll) return;

        for (let i = 0; i < this.items.length; i++) {
            this.setItemInteractable(this.items[i], i === this.currentItemIndex);
        }
    }

    /**
     * Kết thúc lượt của item hiện tại và chuyển sang item kế tiếp.
     *
     * @param source Component gọi hàm này. Bắt buộc với item không phải CleanItem (xem bên dưới).
     *               Event wiring trong scene truyền vào customEventData (string) nên bị coi là
     *               không rõ nguồn.
     */
    public ItemCleanDone(source?: unknown): void {
        if (this.isTransitioning || this.currentItemIndex < 0 || this.hasCompletedSequence) return;

        const item = this.items[this.currentItemIndex];
        if (!item || !item.isValid) {
            this.ShowNextItem();
            return;
        }

        const cleanItem = item.getComponent('CleanItem') as CleanItem | null;
        if (cleanItem) {
            // Một CleanItem nhiều vết bẩn có thể nối từng DirtCleaner.onComplete vào đây;
            // chỉ đẩy lượt khi đã sạch hết.
            if (!cleanItem.IsAllCleaned) return;
        } else if (!(source instanceof Component) || source.node !== item.node) {
            // Item của lượt này không phải CleanItem (ví dụ TrashBin) nên không tự xác nhận được
            // là đã xong; chỉ chính nó mới được kết thúc lượt của mình.
            //
            // Nếu không chặn: một CleanItem vừa xong ở lượt trước thường bắn ItemCleanDone nhiều
            // lần liên tiếp (callItemCleanDoneOnAllCleaned + các DirtCleaner.onComplete nối thẳng
            // trong scene). Tiếng gọi đầu đẩy lượt sang TrashBin, tiếng thứ hai đẩy tiếp qua luôn
            // => rác vừa mở khoá đã bị khoá lại và onAllItemsCleaned bắn sớm.
            return;
        }

        this.disarmHandTut(item);

        if (this.displayMode === CleanItemDisplayMode.ShowAll) {
            // Item đã lau xong vẫn nằm nguyên tại chỗ; ShowNextItem() sẽ đổi lượt và
            // applyTurnGate() tự khoá cái vừa xong, mở cái kế tiếp.
            this.ShowNextItem();
            return;
        }

        this.isTransitioning = true;
        this.stopActiveTween();
        const zeroScale = this.getZeroScale(item);
        this.activeTween = tween(item.node)
            .to(this.zoomDuration, { scale: zeroScale }, { easing: 'backIn' })
            .call(() => {
                item.node.active = false;
                this.activeTween = null;
                this.isTransitioning = false;
                this.ShowNextItem();
            })
            .start();
    }

    /** Shows the following valid item in the configured order. */
    public ShowNextItem(): void {
        if (this.isTransitioning || this.hasCompletedSequence) return;

        let nextIndex = this.currentItemIndex + 1;
        while (nextIndex < this.items.length && this.shouldSkipItem(nextIndex)) {
            nextIndex++;
        }

        if (nextIndex >= this.items.length) {
            this.currentItemIndex = -1;
            this.applyTurnGate();
            this.hasCompletedSequence = true;
            this.MoveScreenTargetOnComplete();
            Ply_SoundManager.Ins?.PlayFx(FxType.Aha);
            this.onAllItemsCleaned?.invoke();
            return;
        }

        this.currentItemIndex = nextIndex;
        const item = this.items[nextIndex];

        // ShowAll đã bung hết item kèm hiệu ứng appear ngay từ RevealAllItems(), nên chuyển lượt
        // chỉ là mở khoá item mới - không zoom lại. Chỉ Sequential mới cần appear từng cái.
        if (this.displayMode === CleanItemDisplayMode.ShowAll) {
            this.applyTurnGate();
        } else {
            const targetScale = this.getItemScale(item);
            item.node.active = true;
            item.node.setScale(this.getZeroScale(item));
            Ply_SoundManager.Ins?.PlayFx(FxType.CleanItemAppear);
            this.SpawnItemShowCloud(item);

            this.stopActiveTween();
            this.activeTween = tween(item.node)
                .to(this.zoomDuration, { scale: targetScale }, { easing: 'backOut' })
                .call(() => this.activeTween = null)
                .start();
        }

        // Next frame: HandTutManager.start() may still run after ours on the
        // first item and would otherwise reset the started flag we set here.
        this.scheduleOnce(() => this.armHandTut(item), 0);
    }

    /**
     * Item nào không được nhận lượt. Ở ShowAll mọi item đều hiện nên người chơi có thể lau
     * item của lượt sau trước; item đã sạch phải bị bỏ qua, nếu không lượt sẽ đứng lại ở nó
     * vì DirtCleaner.onComplete của nó đã bắn xong từ trước.
     */
    private shouldSkipItem(index: number): boolean {
        const item = this.items[index];
        if (!item || !item.isValid) return true;
        if (this.displayMode !== CleanItemDisplayMode.ShowAll) return false;

        const cleanItem = item.getComponent('CleanItem') as CleanItem | null;
        return !!cleanItem?.IsAllCleaned;
    }

    /** Registers the shown item with HandTutManager and restarts its idle delay. */
    private armHandTut(item: Component): void {
        if (!this.enableHandTut || !item?.isValid || !item.node.activeInHierarchy) return;

        const handTut = HandTutManager.Ins;
        const tutorialItem = this.getTutorialItem(item);
        if (!handTut || !tutorialItem) return;

        handTut.AddItem(tutorialItem, true);
        handTut.SetIdleDelayOverride(this.handTutDelay);
        handTut.StartHandTut();
    }

    private disarmHandTut(item: Component): void {
        const tutorialItem = this.getTutorialItem(item);
        if (tutorialItem) HandTutManager.Ins?.ItemDone(tutorialItem);
    }

    private getTutorialItem(item: Component): Item | null {
        // String lookup keeps Item out of this file's imports (see the note on `items`).
        return item.getComponent('Item') as Item | null;
    }

    private cacheItemScales(): void {
        for (const item of this.items) {
            if (!item || !item.isValid || this.itemScales.has(item)) continue;
            this.itemScales.set(item, item.node.scale.clone());
        }
    }

    private setAllItemsInactive(): void {
        for (const item of this.items) {
            if (!item || !item.isValid) continue;
            Tween.stopAllByTarget(item.node);
            item.node.active = false;
        }
    }

    private getItemScale(item: Component): Vec3 {
        return this.itemScales.get(item)?.clone() ?? item.node.scale.clone();
    }

    private getZeroScale(item: Component): Vec3 {
        const scale = this.getItemScale(item);
        return new Vec3(0, 0, scale.z);
    }

    private stopActiveTween(): void {
        this.activeTween?.stop();
        this.activeTween = null;
    }

    private SpawnItemShowCloud(item: Component): void {
        if (!this.spawnCloudOnItemShow) return;

        const cloud = World.instance?.poolManager?.spawnType<CloudEffect>(PoolType.Cloud, item.node.worldPosition);
        if (!cloud) return;

        // Render beside the item rather than under the pool root. This keeps
        // the cloud in the same Canvas/layer and above the appearing item.
        const itemParent = item.node.parent;
        if (itemParent) {
            const worldPosition = item.node.worldPosition.clone();
            cloud.node.setParent(itemParent);
            cloud.node.setWorldPosition(worldPosition);
            cloud.node.setSiblingIndex(itemParent.children.length - 1);
        }

        cloud.PlaySpawn();
    }

    public resetInEditor(): void {
        if (!this.onAllItemsCleaned) this.onAllItemsCleaned = new Ply_Event();
        if (!this.onCompleteScreen) this.onCompleteScreen = new Ply_Event();
    }

    private MoveScreenTargetOnComplete(): void {
        const target = ipm?.screenTarget;
        if (!this.moveScreenTargetOnComplete || !target?.isValid) {
            this.onCompleteScreen?.invoke();
            return;
        }

        this.completedScreenTargetTween?.stop();
        const destinationScale = new Vec3(
            this.completedScreenTargetScale,
            this.completedScreenTargetScale,
            target.scale.z,
        );
        this.completedScreenTargetTween = tween(target)
            .to(this.completedScreenTargetDuration, {
                position: this.completedScreenTargetPosition,
                scale: destinationScale,
            }, { easing: 'sineInOut' })
            .call(() => {
                this.completedScreenTargetTween = null;
                this.onCompleteScreen?.invoke();
            })
            .start();
    }
}
