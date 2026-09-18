import { _decorator, Component, Node, Tween, tween, Vec3 } from 'cc';
import type { CloudEffect } from '../Effects/CloudEffect';
import type { Item } from '../Items/Components/Item';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { World } from '../../Core/Managers/World';
import { ipm } from '../../Core/Managers/InputManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { HandTutManager } from './HandTutManager';

const { ccclass, property } = _decorator;

/**
 * Shows cleaning items one at a time. Call ItemCleanDone() when the current
 * item has been cleaned to hide it and reveal the next configured item.
 */
@ccclass('ItemCleanManager')
export class ItemCleanManager extends Ply_Singleton<ItemCleanManager> {
    // Do not reference Item here. Item imports this manager, so that would
    // create a runtime circular import in Cocos' scene script loader.
    @property([Component])
    public items: Component[] = [];

    @property({ tooltip: 'Show the first item automatically when this manager starts.' })
    public autoStart = true;

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
        this.ShowNextItem();
    }

    /** Hides the active item, then displays the next one in the array. */
    public ItemCleanDone(): void {
        if (this.isTransitioning || this.currentItemIndex < 0 || this.hasCompletedSequence) return;

        const item = this.items[this.currentItemIndex];
        if (!item || !item.isValid) {
            this.ShowNextItem();
            return;
        }

        this.disarmHandTut(item);
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
        while (nextIndex < this.items.length && (!this.items[nextIndex] || !this.items[nextIndex].isValid)) {
            nextIndex++;
        }

        if (nextIndex >= this.items.length) {
            this.currentItemIndex = -1;
            this.hasCompletedSequence = true;
            this.MoveScreenTargetOnComplete();
            Ply_SoundManager.Ins?.PlayFx(FxType.Aha);
            this.onAllItemsCleaned?.invoke();
            return;
        }

        this.currentItemIndex = nextIndex;
        const item = this.items[nextIndex];
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

        // Next frame: HandTutManager.start() may still run after ours on the
        // first item and would otherwise reset the started flag we set here.
        this.scheduleOnce(() => this.armHandTut(item), 0);
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
