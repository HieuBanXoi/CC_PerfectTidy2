import { _decorator, Enum, input, Input, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemType } from '../Items/Components/ItemType';
import { ItemStirring } from '../Items/Components/ItemStirring';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
// Chỉ import type: ItemSnap -> InputManager -> HandTutManager là một vòng, import runtime
// sẽ làm decorator @property chạy lúc ItemSnap còn undefined.
import type { ItemSnap } from '../Items/Snapping/ItemSnap';

const { ccclass, property } = _decorator;

export enum TypeHind {
    None = 0,
    Click,
    Drag,
    Stir,
}
Enum(TypeHind);

/**
 * Idle guidance for the currently playable cooking action.
 *
 * Add this component to a manager node, then assign a hand node under the
 * Canvas and the ordered list of tutorial items in the Inspector.
 */
@ccclass('HandTutManager')
export class HandTutManager extends Ply_Singleton<HandTutManager> {
    @property({ type: [Item], tooltip: 'Items in gameplay/tutorial priority order.' })
    public items: Item[] = [];

    @property(Node)
    public handNode: Node = null!;

    @property({ tooltip: 'Wait for StartHandTut() instead of beginning automatically.' })
    public waitForStartSignal = false;

    @property({ min: 0 }) public idleDelay = 5;
    @property({ min: 0 }) public firstHandTutDelay = 5;
    @property({ min: 0 }) public shortIdleDelay = 0.5;
    @property({ min: 0 }) public noDelayItemCount = 3;
    @property({ min: 0 }) public breakHeartNoDelayThreshold = 3;
    @property({ min: 0 }) public maxHandTutShowCount = 0;

    @property({ min: 0.01 }) public moveDuration = 1.2;
    @property({ min: 0.01 }) public clickScaleDuration = 0.35;
    @property({ min: 0 }) public waitAtEndDuration = 0.2;
    @property public clickScaleMultiplier = 1.25;

    // ==================== ITEMSNAP HINT ====================
    // Gộp từ ItemSpawnManager: trước đây nó chạy một bộ hand tut riêng trên cùng node hand,
    // hai bên phải né nhau bằng cặp cờ isShowingHint / isSpawnHandTutShowing và giành quyền
    // bằng ResetHandTutDelay(). Giờ chỉ còn một node hand, một idle timer, một thứ tự ưu tiên:
    // Item thường -> ItemSnap -> fallback click.

    @property({ tooltip: 'Bật hand tut kéo cho các ItemSnap đang chờ vào holder (ItemSpawnManager đăng ký item vào đây)' })
    public enableItemSnapHint = true;

    @property({ min: -1, tooltip: 'Delay riêng khi lượt gợi ý kế tiếp là ItemSnap. -1 = dùng idleDelay chung' })
    public itemSnapHintDelay = 7;

    @property({ min: -1, step: 1, tooltip: 'Số ItemSnap (khác nhau) được gợi ý. -1 = không giới hạn, 0 = tắt' })
    public maxItemSnapHintCount = -1;

    // =======================================================

    @property({type:Item})
    public currentItemHandTut: Item | null = null;

    @property({ type: Enum(TypeHind), readonly: true })
    public TypeHind: TypeHind = TypeHind.None;

    private idleTimer = 0;
    private isStarted = false;
    private isPaused = false;
    private isPointerDown = false;
    private isGameplayDragging = false;
    private isScreenNavigating = false;
    private shownCount = 0;
    private hasShownFirstHint = false;
    private consecutiveDropFails = 0;
    private forceNoDelay = false;
    private handDefaultScale = new Vec3(1, 1, 1);
    private handDefaultAlpha = 255;
    private handOpacity: UIOpacity | null = null;
    private currentHintToken = 0;
    private activeAuxTween: Tween<object> | null = null;
    private boundItems = new Set<Item>();
    // Guards the hand node against being reset by a hide() that this manager did not cause.
    private isShowingHint = false;
    private idleDelayOverride = -1;
    private snapItems: ItemSnap[] = [];
    private boundSnapItems = new Set<ItemSnap>();
    private hintedSnapItems = new Set<ItemSnap>();
    private itemSnapHintCondition: (() => boolean) | null = null;
    private currentSnapHandTut: ItemSnap | null = null;
    private fallbackClickNode: Node | null = null;
    private fallbackClickCondition: (() => boolean) | null = null;
    private currentFallbackNode: Node | null = null;

    protected onLoad(): void {
        super.onLoad();
        if (this.handNode) {
            Vec3.copy(this.handDefaultScale, this.handNode.scale);
            this.handOpacity = this.handNode.getComponent(UIOpacity);
            this.handDefaultAlpha = this.handOpacity?.opacity ?? 255;
            this.handNode.active = false;
        }

        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    protected start(): void {
        this.bindConfiguredItems();
        this.isStarted = !this.waitForStartSignal;
    }

    protected update(deltaTime: number): void {
        this.removeCompletedItems();
        if (!this.isStarted || this.isPaused || !this.handNode) return;

        // A phase can deactivate an item while its hint is already playing.
        // Hide it immediately so the hand never points to invisible content.
        if (this.currentItemHandTut
            && (!this.currentItemHandTut.node.activeInHierarchy
                || this.currentItemHandTut.isDone
                // Hint kéo mà đích biến mất giữa chừng (vết bẩn vừa lau xong) thì tắt ngay,
                // đừng đợi hết một vòng tween mới nhận ra.
                || (this.TypeHind === TypeHind.Drag && !this.hasValidDragTarget(this.currentItemHandTut)))) {
            this.hideHandTut();
            this.resetIdleTimer();
            return;
        }

        // Same for an ItemSnap hint whose item was picked up, placed, or locked.
        if (this.currentSnapHandTut && !this.canHintItemSnap(this.currentSnapHandTut)) {
            this.hideHandTut();
            this.resetIdleTimer();
            return;
        }

        // Same for the fallback click target (for example ItemBox once its
        // items are on screen or it has been emptied).
        if (this.currentFallbackNode && !this.canShowFallbackClick()) {
            this.hideHandTut();
            this.resetIdleTimer();
            return;
        }

        if (this.isPointerDown || this.isGameplayDragging || this.isScreenNavigating) {
            this.resetIdleTimer();
            this.hideHandTut();
            return;
        }

        this.idleTimer += deltaTime;
        if (!this.handNode.active && this.idleTimer >= this.getCurrentDelay()) {
            this.idleTimer = 0;
            this.showNextHandTut();
        }
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        this.hideHandTut();
    }

    public StartHandTut(): void {
        this.isPaused = false;
        this.isStarted = true;
        this.resetIdleTimer();
    }

    public StartHandTutNoDelay(): void {
        this.forceNoDelay = true;
        this.StartHandTut();
        this.showNextHandTut();
    }

    /** Stops the idle timer and hides the current hint during a phase transition. */
    public PauseHandTut(): void {
        this.isPaused = true;
        this.isPointerDown = false;
        this.isGameplayDragging = false;
        this.hideHandTut();
        this.resetIdleTimer();
    }

    /** Hides the current hint and restarts its idle delay without pausing future hints. */
    public ResetHandTutDelay(): void {
        this.hideHandTut();
        this.resetIdleTimer();
    }

    /** Pauses the idle timer during screen drag/zoom, then restarts it when navigation ends. */
    public SetScreenNavigationActive(isActive: boolean): void {
        this.isScreenNavigating = isActive;
        this.ResetHandTutDelay();
    }

    public ItemDone(item: Item): void {
        const index = this.items.indexOf(item);
        if (index >= 0) this.items.splice(index, 1);
        this.RegisterCorrectAction();
    }

    /** Registers an item at runtime (for example a cleaning item revealed by ItemCleanManager). */
    public AddItem(item: Item, prioritize = false): void {
        if (!item || this.items.includes(item)) return;
        if (prioritize) this.items.unshift(item);
        else this.items.push(item);
        this.bindConfiguredItems();
    }

    /**
     * Node that receives a click (zoom in/out) hint whenever no configured item
     * is ready, for example an ItemBox waiting to be opened. `canShow` is
     * re-checked every frame while that hint plays. Pass null to clear.
     */
    public SetFallbackClickTarget(node: Node | null, canShow: (() => boolean) | null = null): void {
        if (this.currentFallbackNode && this.currentFallbackNode !== node) this.ResetHandTutDelay();
        this.fallbackClickNode = node;
        this.fallbackClickCondition = canShow;
    }

    /** Clears the fallback target, or does nothing when `node` is not the registered one. */
    public ClearFallbackClickTarget(node?: Node): void {
        if (node && this.fallbackClickNode !== node) return;
        this.SetFallbackClickTarget(null);
    }

    /**
     * ItemSpawnManager gọi cho mỗi ItemSnap vừa spawn / vừa hiện ra. Item tự rụng khỏi danh
     * sách khi bị huỷ, nên không bắt buộc phải gọi RemoveItemSnap().
     */
    public AddItemSnap(item: ItemSnap): void {
        if (!this.enableItemSnapHint || !item?.isValid || this.snapItems.includes(item)) return;
        this.snapItems.push(item);
        this.bindItemSnap(item);
    }

    public RemoveItemSnap(item: ItemSnap): void {
        const index = this.snapItems.indexOf(item);
        if (index >= 0) this.snapItems.splice(index, 1);
        if (this.currentSnapHandTut === item) this.hideHandTut();
    }

    /**
     * Điều kiện phụ để hint ItemSnap được phép chạy, kiểm lại mỗi frame giống
     * SetFallbackClickTarget. ItemSpawnManager dùng để chặn lúc còn item đang bay từ hộp
     * hoặc đã đạt giới hạn đặt item. Truyền null để bỏ điều kiện.
     */
    public SetItemSnapHintCondition(canShow: (() => boolean) | null): void {
        this.itemSnapHintCondition = canShow;
    }

    /**
     * Replaces idleDelay/firstHandTutDelay/noDelayItemCount with a fixed delay
     * so gameplay managers can own their own hint timing. Negative = use the
     * configured delays again.
     */
    public SetIdleDelayOverride(delay: number): void {
        this.idleDelayOverride = delay;
    }

    public RegisterCorrectAction(): void {
        this.isGameplayDragging = false;
        this.consecutiveDropFails = 0;
        this.forceNoDelay = false;
        this.hideHandTut();
        this.resetIdleTimer();
    }

    public RegisterBreakHeartDropFail(): void {
        this.isGameplayDragging = false;
        this.consecutiveDropFails++;
        if (this.consecutiveDropFails >= this.breakHeartNoDelayThreshold) {
            this.forceNoDelay = true;
            this.resetIdleTimer();
        }
    }

    private onTouchStart(): void {
        if (this.isPaused) return;
        this.isPointerDown = true;
        // if (!this.isStarted) this.StartHandTut();
        this.hideHandTut();
        this.resetIdleTimer();
    }

    private onTouchEnd(): void {
        this.isPointerDown = false;
        this.resetIdleTimer();
    }

    private bindConfiguredItems(): void {
        for (const item of this.items) {
            if (!item || this.boundItems.has(item)) continue;
            this.boundItems.add(item);
            item.itemClickable?.onClick.addListener(() => this.RegisterCorrectAction());
            item.itemDraggable?.onBeginDrag.addListener(() => this.OnGameplayDragBegin());
            item.itemDraggable?.onDropSuccess.addListener(() => this.RegisterCorrectAction());
            item.itemDraggable?.onDropFail.addListener(() => this.RegisterBreakHeartDropFail());
            item.itemStirring?.onStirComplete.addListener(() => this.RegisterCorrectAction());
        }
    }

    private OnGameplayDragBegin(): void {
        this.isGameplayDragging = true;
        this.hideHandTut();
        this.resetIdleTimer();
    }

    private showNextHandTut(): void {
        if (!this.canShowMore()) {
            this.currentItemHandTut = null;
            return;
        }
        this.bindConfiguredItems();
        const item = this.getFirstTutorialReadyItem();
        if (!item) {
            this.currentItemHandTut = null;

            // Hết Item thường sẵn sàng thì tới lượt ItemSnap.
            const snapItem = this.getFirstReadyItemSnap();
            if (snapItem) {
                this.hintedSnapItems.add(snapItem);
                this.playItemSnapHint(snapItem);
                this.currentSnapHandTut = snapItem;
                this.TypeHind = TypeHind.Drag;
                return;
            }

            if (this.canShowFallbackClick()) {
                this.playClickHint(this.fallbackClickNode!);
                this.currentFallbackNode = this.fallbackClickNode;
                this.TypeHind = TypeHind.Click;
            }
            return;
        }

        if (this.isClickableReady(item)) {
            this.playClickHint(item.node);
            this.currentItemHandTut = item;
            this.TypeHind = TypeHind.Click;
        } else if (this.isDraggableReady(item) && this.hasValidDragTarget(item)) {
            this.playMoveHint(item);
            this.currentItemHandTut = item;
            this.TypeHind = TypeHind.Drag;
        } else if (this.isStirringReady(item)) {
            this.playStirringHint(item.itemStirring!);
            this.currentItemHandTut = item;
            this.TypeHind = TypeHind.Stir;
        }
    }

    private getFirstTutorialReadyItem(): Item | null {
        // Current processing items always have priority, while retaining the
        // Inspector list order and skipping invalid entries.
        for (const item of this.items) {
            if (!item?.onProcess || !this.canShowTutorialForItem(item)) continue;
            return item;
        }

        // If nothing is currently processing, fall back to the ordered list.
        for (const item of this.items) {
            if (!this.canShowTutorialForItem(item)) continue;
            return item;
        }

        return null;
    }

    private canShowTutorialForItem(item: Item): boolean {
        if (!item || item.isDone || !item.node.activeInHierarchy) return false;

        // Draggable items with no target type are never tutorial candidates,
        // even if a default move target happens to be assigned.
        if (item.itemDraggable?.enabled
            && item.itemDraggable.targetItemType === ItemType.None
            && !item.allowHandTutDragWithoutTargetType) {
            return false;
        }

        return this.isClickableReady(item)
            || (this.isDraggableReady(item) && this.hasValidDragTarget(item))
            || this.isStirringReady(item);
    }

    private isClickableReady(item: Item): boolean {
        return !!item.itemClickable?.enabled && item.itemClickable.canClick;
    }

    private isDraggableReady(item: Item): boolean {
        return !!item.itemDraggable?.enabled && item.itemDraggable.CanDrag();
    }

    /** Validates the configured drag target, including optional type matching. */
    private hasValidDragTarget(item: Item): boolean {
        // GetHandTutTarget() chứ không phải defaultTarget: CleanItem trả về vết bẩn chưa lau,
        // và trả null khi đã sạch hết nên item đó tự rụng khỏi danh sách ứng viên.
        const target = item.GetHandTutTarget();
        const draggable = item.itemDraggable;
        if (!target || !target.isValid || !target.activeInHierarchy || !draggable) return false;
        if (!item.requireMatchingTargetTypeForHandTut) return true;

        const targetItem = target.getComponent(Item);
        return !!targetItem && targetItem.itemType === draggable.targetItemType;
    }

    private isStirringReady(item: Item): boolean {
        return !!item.itemStirring?.enabled && !item.itemStirring.IsDone;
    }

    private bindItemSnap(item: ItemSnap): void {
        if (this.boundSnapItems.has(item)) return;
        this.boundSnapItems.add(item);

        item.onStartDrag.addListener(() => this.OnGameplayDragBegin());
        item.onPlacedSuccess.addListener(() => this.RegisterCorrectAction());
        item.onPlacedFail.addListener(() => this.ResetHandTutDelay());
    }

    /** ItemSnap đang chờ, nằm trên cùng (siblingIndex lớn nhất) và còn trong hạn mức gợi ý. */
    private getFirstReadyItemSnap(): ItemSnap | null {
        if (!this.enableItemSnapHint || this.snapItems.length === 0) return null;
        if (this.itemSnapHintCondition && !this.itemSnapHintCondition()) return null;

        let best: ItemSnap | null = null;
        for (const item of this.snapItems) {
            if (!this.canHintItemSnap(item)) continue;
            if (!best || item.node.getSiblingIndex() > best.node.getSiblingIndex()) best = item;
        }
        return best;
    }

    private canHintItemSnap(item: ItemSnap): boolean {
        // CanStartDrag đã gộp sẵn enabled + không bị khoá kéo + đang ở trạng thái Waiting.
        if (!item?.isValid || !item.node?.activeInHierarchy) return false;
        if (!item.CanStartDrag || !item.CanPlaced()) return false;
        if (this.itemSnapHintCondition && !this.itemSnapHintCondition()) return false;

        if (this.maxItemSnapHintCount < 0) return true;
        if (this.hintedSnapItems.has(item)) return true;
        return this.hintedSnapItems.size < this.maxItemSnapHintCount;
    }

    /**
     * Kéo từ item tới holder đúng của nó. Khác playMoveHint ở chỗ toạ độ được đọc lại mỗi
     * vòng lặp: item chờ vẫn đang nhấp nhô và holder có thể bị đổi/ẩn giữa chừng.
     */
    private playItemSnapHint(item: ItemSnap): void {
        const token = this.prepareHand(item.node.worldPosition);
        const endPosition = new Vec3();

        const loop = () => {
            if (!this.isHintCurrent(token)) return;
            if (!this.canHintItemSnap(item)) {
                this.hideHandTut();
                return;
            }

            this.bringHandToFront();
            this.handNode.setWorldPosition(item.node.worldPosition);
            this.setHandAlpha(this.handDefaultAlpha);

            const holder = item.correctHolderTransform;
            endPosition.set(holder?.activeInHierarchy ? holder.worldPosition : item.node.worldPosition);

            tween(this.handNode)
                .to(this.moveDuration, { worldPosition: endPosition }, { easing: 'sineInOut' })
                .call(() => this.setHandAlpha(0))
                .delay(this.waitAtEndDuration)
                .call(loop)
                .start();
        };

        loop();
    }

    /** Hand phải nằm trên cùng, item vừa BringToFront có thể đã chen lên trước nó. */
    private bringHandToFront(): void {
        const parent = this.handNode?.parent;
        if (parent) this.handNode.setSiblingIndex(parent.children.length - 1);
    }

    private canShowFallbackClick(): boolean {
        const node = this.fallbackClickNode;
        if (!node?.isValid || !node.activeInHierarchy) return false;
        return this.fallbackClickCondition ? this.fallbackClickCondition() : true;
    }

    private playClickHint(target: Node): void {
        const token = this.prepareHand(target.worldPosition);
        const loop = () => {
            if (!this.isHintCurrent(token)) return;
            tween(this.handNode)
                .to(this.clickScaleDuration, { scale: this.handDefaultScale.clone().multiplyScalar(this.clickScaleMultiplier) }, { easing: 'sineOut' })
                .to(this.clickScaleDuration, { scale: this.handDefaultScale }, { easing: 'sineIn' })
                .delay(this.waitAtEndDuration)
                .call(loop)
                .start();
        };
        loop();
    }

    /**
     * Kéo từ item tới đích của nó. Cả hai đầu đều được đọc lại mỗi vòng lặp: item có thể đã bị
     * người chơi kéo đi chỗ khác, còn đích thì đổi theo trạng thái (CleanItem nhảy sang vết bẩn
     * kế tiếp ngay khi lau xong một vết).
     */
    private playMoveHint(item: Item): void {
        const token = this.prepareHand(item.node.worldPosition);
        const endPosition = new Vec3();

        const loop = () => {
            if (!this.isHintCurrent(token)) return;

            const target = item.GetHandTutTarget();
            if (!target?.isValid || !target.activeInHierarchy) {
                this.hideHandTut();
                return;
            }

            this.handNode.setWorldPosition(item.node.worldPosition);
            this.setHandAlpha(this.handDefaultAlpha);
            endPosition.set(target.worldPosition);

            tween(this.handNode)
                .to(this.moveDuration, { worldPosition: endPosition }, { easing: 'sineInOut' })
                .call(() => this.setHandAlpha(0))
                .delay(this.waitAtEndDuration)
                .call(loop)
                .start();
        };
        loop();
    }

    private playStirringHint(stirring: ItemStirring): void {
        const center = (stirring.centerPoint ?? stirring.node).worldPosition.clone();
        const radius = Math.max(1, stirring.stirRadius);
        const start = new Vec3(center.x + radius, center.y, center.z);
        const token = this.prepareHand(start);
        const loop = () => {
            if (!this.isHintCurrent(token)) return;
            const state = { angle: 0 };
            this.activeAuxTween = tween(state)
                .to(this.moveDuration, { angle: Math.PI * 2 }, {
                    onUpdate: value => {
                        const angle = (value as { angle: number }).angle;
                        this.handNode.setWorldPosition(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, center.z);
                    },
                })
                .delay(this.waitAtEndDuration)
                .call(loop)
                .start();
        };
        loop();
    }

    private prepareHand(position: Vec3): number {
        this.hideHandTut();
        this.currentHintToken++;
        this.handNode.setWorldPosition(position);
        this.handNode.setScale(this.handDefaultScale);
        this.setHandAlpha(this.handDefaultAlpha);
        this.handNode.active = true;
        this.isShowingHint = true;
        this.shownCount++;
        this.hasShownFirstHint = true;
        this.forceNoDelay = false;
        return this.currentHintToken;
    }

    private hideHandTut(): void {
        this.currentHintToken++;
        this.currentItemHandTut = null;
        this.currentSnapHandTut = null;
        this.currentFallbackNode = null;
        this.TypeHind = TypeHind.None;
        this.activeAuxTween?.stop();
        this.activeAuxTween = null;
        if (!this.handNode || !this.isShowingHint) return;
        this.isShowingHint = false;
        Tween.stopAllByTarget(this.handNode);
        this.handNode.setScale(this.handDefaultScale);
        this.setHandAlpha(this.handDefaultAlpha);
        this.handNode.active = false;
    }

    private isHintCurrent(token: number): boolean {
        return !!this.handNode?.isValid && this.handNode.activeInHierarchy && token === this.currentHintToken;
    }

    private setHandAlpha(alpha: number): void {
        if (this.handOpacity) this.handOpacity.opacity = alpha;
    }

    private getCurrentDelay(): number {
        if (this.forceNoDelay) return this.shortIdleDelay;
        if (this.idleDelayOverride >= 0) return this.idleDelayOverride;
        if (this.shownCount < this.noDelayItemCount) return this.shortIdleDelay;

        // Lượt kế tiếp sẽ là hint ItemSnap (không còn Item thường nào sẵn sàng) => dùng delay
        // riêng của nó, đúng bằng handTutDelay mà ItemSpawnManager giữ trước đây.
        if (this.itemSnapHintDelay >= 0
            && this.snapItems.length > 0
            && !this.getFirstTutorialReadyItem()
            && !!this.getFirstReadyItemSnap()) {
            return this.itemSnapHintDelay;
        }

        return this.hasShownFirstHint ? this.idleDelay : this.firstHandTutDelay;
    }

    private canShowMore(): boolean {
        return this.maxHandTutShowCount <= 0 || this.shownCount < this.maxHandTutShowCount;
    }

    private resetIdleTimer(): void {
        this.idleTimer = 0;
    }

    private removeCompletedItems(): void {
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (!this.items[i] || this.items[i].isDone) this.items.splice(i, 1);
        }

        for (let i = this.snapItems.length - 1; i >= 0; i--) {
            if (!this.snapItems[i]?.isValid) this.snapItems.splice(i, 1);
        }
    }
}
