import { _decorator, Node, Tween, tween, Vec2, Vec3, Enum, EventTouch, UITransform } from 'cc';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { InputManager } from '../../../Core/Managers/InputManager';
import { ItemType } from './ItemType';
import type { Item } from './Item';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

@ccclass('ItemDraggable')
export class ItemDraggable extends Ply_EventHandlerComponent {

    @property
    public isDraggable: boolean = true;

    @property(Node)
    public returnTransform: Node = null!;

    @property
    public setParentToReturnTransform: boolean = true;

    @property
    public returnToStartOnDragFailed: boolean = true;

    @property
    public returnToExactReturnTransformPosition: boolean = true;

    @property
    public cacheStartPosWhenStart: boolean = false;

    @property({ type: Enum(ItemType) })
    public targetItemType: ItemType = ItemType.None;

    @property(Node)
    public shadowObject: Node = null!;

    @property
    public playReturnToStartFinishSound: boolean = false;

    @property({ type: Enum(FxType) })
    public returnToStartFinishFxType: FxType = FxType.Failed;

    @property
    public spawnBreakHeartOnDropFail: boolean = true;

    @property
    public playBeginDragSound: boolean = true;

    @property({ type: Enum(FxType) })
    public beginDragFxType: FxType = FxType.Click;

    @property({ tooltip: 'Độ lệch (X, Y) khi kéo item, giúp nhấc item lên một đoạn để không bị ngón tay che khuất' })
    public dragOffset: Vec2 = new Vec2(0, 0);

    @property({ tooltip: 'Thời gian nâng item theo dragOffset khi bắt đầu kéo (giây)' })
    public dragOffsetDuration: number = 0.15;

    @property
    public dragScaleMultiplier: number = 1.1;

    @property
    public dragScaleDuration: number = 0.15;

    @property({ type: Ply_Event, tooltip: 'On begin drag event' })
    public onBeginDrag: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'On drop success event (Passes target Node)' })
    public onDropSuccess: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'On drop fail event' })
    public onDropFail: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'On return to start complete event' })
    public onReturnToStartComplete: Ply_Event = new Ply_Event();

    public item: Item | null = null;

    private originalParent: Node | null = null;
    private originalSiblingIndex: number = 0;
    private originalLocalPos: Vec3 = new Vec3();
    private originalScale: Vec3 = new Vec3();
    private originalWorldPos: Vec3 = new Vec3();

    private isDraggingSession: boolean = false;
    private isReturningToStart: boolean = false;
    private isForceReturningToStart: boolean = false;
    private spawnHeartOnReturnComplete: boolean = true;
    private enableDraggableOnReturnComplete: boolean = false;
    private consumeCurrentDropFail: boolean = false;
    private pendingDragDelta: Vec2 = new Vec2();

    private cachedReturnPosition: Vec3 = new Vec3();
    private hasCachedReturnPosition: boolean = false;

    public get IsDragging(): boolean {
        return this.isDraggingSession;
    }

    public get IsReturningToStart(): boolean {
        return this.isReturningToStart;
    }

    public resetInEditor() {
        if (!this.onBeginDrag) this.onBeginDrag = new Ply_Event();
        if (!this.onDropSuccess) this.onDropSuccess = new Ply_Event();
        if (!this.onDropFail) this.onDropFail = new Ply_Event();
        if (!this.onReturnToStartComplete) this.onReturnToStartComplete = new Ply_Event();
    }

    protected onLoad() {
        this.item = this.getComponent('Item') as Item | null;
        this.originalParent = this.node.parent;
        this.originalSiblingIndex = this.node.getSiblingIndex();
        Vec3.copy(this.originalLocalPos, this.node.position);
        Vec3.copy(this.originalScale, this.node.scale);
        Vec3.copy(this.originalWorldPos, this.node.worldPosition);

        // Ensure node has a valid UITransform for touch events.
        let uiTransform = this.getComponent(UITransform);
        if (!uiTransform) {
            uiTransform = this.addComponent(UITransform);
            uiTransform.setContentSize(100, 100);
        }

        if (this.cacheStartPosWhenStart) {
            Vec3.copy(this.cachedReturnPosition, this.returnTransform ? this.returnTransform.worldPosition : this.node.worldPosition);
            this.hasCachedReturnPosition = true;
        }

    }

    public HandleTouchMove(event: EventTouch) {
        if (!this.isDraggingSession) return;

        // InputManager applies screen bounds, locks and speed while this item
        // is held near a screen edge.
        InputManager.Ins?.UpdateItemDragScreenEdgePointer(event.getUILocation());

        // Item positions are in Canvas/UI coordinates, not physical screen
        // pixels. Convert the pointer delta to the same coordinate system so
        // its visible movement stays aligned with the cursor at any canvas
        // scale or aspect ratio.
        const uiDelta = event.getUIDelta();
        this.pendingDragDelta.set(
            this.pendingDragDelta.x + uiDelta.x,
            this.pendingDragDelta.y + uiDelta.y,
        );
    }

    protected update(): void {
        this.ApplyPendingDragMove();
    }

    private ApplyPendingDragMove(): void {
        if (!this.isDraggingSession || (this.pendingDragDelta.x === 0 && this.pendingDragDelta.y === 0)) return;

        const currentPosition = this.node.worldPosition;
        this.node.setWorldPosition(
            currentPosition.x + this.pendingDragDelta.x,
            currentPosition.y + this.pendingDragDelta.y,
            currentPosition.z,
        );
        this.pendingDragDelta.set(0, 0);
    }

    public CompleteTouchDrag() {
        this.ApplyPendingDragMove();
    }

    public BeginDrag(): boolean {
        if (!GameManager.Ins?.IsPlaying() || !this.CanDrag()) return false;

        Tween.stopAllByTarget(this.node);
        this.pendingDragDelta.set(0, 0);
        this.isReturningToStart = false;
        this.isForceReturningToStart = false;
        this.SetShadowActive(false);
        this.PlayBeginDragSound();

        // Cache original parent and sibling index before moving to draggingNode
        if (this.node.parent && (!InputManager.Ins || this.node.parent !== InputManager.Ins.draggingNode)) {
            this.originalParent = this.node.parent;
            this.originalSiblingIndex = this.node.getSiblingIndex();
            Vec3.copy(this.originalLocalPos, this.node.position);
            Vec3.copy(this.originalWorldPos, this.node.worldPosition);
        }

        // Move to InputManager.Ins.draggingNode to display on top of other elements
        if (InputManager.Ins && InputManager.Ins.draggingNode && InputManager.Ins.draggingNode.isValid && InputManager.Ins.draggingNode.activeInHierarchy) {
            const worldPos = this.node.worldPosition.clone();
            const worldScale = this.node.worldScale.clone();
            this.node.setParent(InputManager.Ins.draggingNode);
            this.node.setWorldPosition(worldPos);
            this.node.setWorldScale(worldScale);
        }

        const scaled = this.originalScale.clone().multiplyScalar(this.dragScaleMultiplier);
        tween(this.node).to(this.dragScaleDuration, { scale: scaled }, { easing: 'backOut' }).start();

        // Apply drag offset (e.g. lift item up so finger does not obstruct view)
        if (this.dragOffset.x !== 0 || this.dragOffset.y !== 0) {
            if (this.dragOffsetDuration > 0) {
                let lastLift = { x: 0, y: 0 };
                const liftTarget = { x: 0, y: 0 };
                tween(liftTarget)
                    .to(this.dragOffsetDuration, { x: this.dragOffset.x, y: this.dragOffset.y }, {
                        easing: 'sineOut',
                        onUpdate: (target: { x: number, y: number }) => {
                            if (!this.isDraggingSession) return;
                            const dx = target.x - lastLift.x;
                            const dy = target.y - lastLift.y;
                            lastLift.x = target.x;
                            lastLift.y = target.y;
                            const cur = this.node.worldPosition;
                            this.node.setWorldPosition(cur.x + dx, cur.y + dy, cur.z);
                        }
                    })
                    .start();
            } else {
                const cur = this.node.worldPosition;
                this.node.setWorldPosition(cur.x + this.dragOffset.x, cur.y + this.dragOffset.y, cur.z);
            }
        }

        this.isDraggingSession = true;
        this.onBeginDrag.invoke();
        return true;
    }

    public EndDrag() {
        if (!this.CanDrag() || !this.isDraggingSession) return;
        this.pendingDragDelta.set(0, 0);
        this.isDraggingSession = false;
        this.consumeCurrentDropFail = false;

        const dropTarget = this.FindMatchingDropTarget();
        if (!dropTarget) {
            this.ResetScale();
            this.onDropFail.invoke();
            if (!this.consumeCurrentDropFail) {
                // Show the failure feedback at the rejected drop position,
                // before this item starts travelling back to its origin.
                if (this.spawnBreakHeartOnDropFail && this.item) {
                    this.item.SpawnBreakHeart();
                }

                if (this.returnToStartOnDragFailed) {
                    this.ReturnToStart(false);
                } else {
                    this.FinalizeFailedDrag(false);
                }
            } else {
                this.SetShadowActive(true);
            }
            return;
        }

        // Drop Success
        this.SetShadowActive(true);
        // Let Pan hide its ingredient bubble for every successful drop.
        // This also supports ItemToTarget configurations whose target is a
        // child node inside a Pan rather than the Pan node itself.
        this.HidePanBubbleHint(dropTarget);
        this.onDropSuccess.invoke(dropTarget);
    }

    public ReturnToStart(spawnHeart: boolean = true, enableDraggableOnComplete: boolean = false) {
        this.spawnHeartOnReturnComplete = spawnHeart;
        this.enableDraggableOnReturnComplete = enableDraggableOnComplete;
        this.isReturningToStart = true;
        Tween.stopAllByTarget(this.node);

        // A canvas resize/orientation change updates the original parent's
        // transform. Returning to the world position cached in onLoad would
        // therefore use the old canvas coordinate system on Web.
        if (!this.hasCachedReturnPosition && !this.returnTransform && this.originalParent?.isValid) {
            this.RestoreOriginalParent();
            tween(this.node)
                .to(0.3, { position: this.originalLocalPos }, { easing: 'quartOut' })
                .call(() => this.OnReturnToStartComplete())
                .start();
            return;
        }

        const targetPos = this.hasCachedReturnPosition ? this.cachedReturnPosition :
            (this.returnTransform ? this.returnTransform.worldPosition : this.originalWorldPos);

        tween(this.node)
            .to(0.3, { worldPosition: new Vec3(targetPos.x, targetPos.y, this.node.worldPosition.z) }, { easing: 'quartOut' })
            .call(() => this.OnReturnToStartComplete())
            .start();
    }

    /** Returns the item to its start position without spawning a failed-drag heart. */
    public ReturnToStartWithoutHeart() {
        this.ReturnToStart(false, true);
    }

    /** Suppresses the generic failed-drop feedback for the current drag only. */
    public ConsumeCurrentDropFail(): void {
        this.consumeCurrentDropFail = true;
    }

    /** Finds an active Item under the dropped item's center whose type matches targetItemType. */
    private FindMatchingDropTarget(): Node | null {
        if (this.targetItemType === ItemType.None) return null;

        const scene = this.node.scene;
        if (!scene) return null;

        const items = scene.getComponentsInChildren('Item') as Item[];
        const myWorldPos = this.node.worldPosition;

        for (let i = 0; i < items.length; i++) {
            const otherItem = items[i];
            if (!otherItem || otherItem.node === this.node || !otherItem.node.activeInHierarchy) continue;
            if (otherItem.itemType !== this.targetItemType) continue;

            const targetTransform = otherItem.getComponent(UITransform);
            if (!targetTransform) continue;

            // Convert the dragged item's pivot (its center) into the target's
            // local UI space, then require it to be inside the target's exact
            // UITransform width/height. No distance-based fallback is allowed.
            const localPoint = targetTransform.convertToNodeSpaceAR(myWorldPos);
            const left = -targetTransform.anchorX * targetTransform.width;
            const right = left + targetTransform.width;
            const bottom = -targetTransform.anchorY * targetTransform.height;
            const top = bottom + targetTransform.height;

            if (localPoint.x >= left && localPoint.x <= right
                && localPoint.y >= bottom && localPoint.y <= top) {
                return otherItem.node;
            }
        }

        return null;
    }

    public TeleportToStart() {
        this.isReturningToStart = false;
        this.isForceReturningToStart = false;
        Tween.stopAllByTarget(this.node);
        this.ResetScale();

        if (!this.hasCachedReturnPosition && !this.returnTransform && this.originalParent?.isValid) {
            this.RestoreOriginalParent();
            this.node.setPosition(this.originalLocalPos);
            this.RestoreOriginalSiblingIndex();
            return;
        }

        const targetPos = this.hasCachedReturnPosition ? this.cachedReturnPosition :
            (this.returnTransform ? this.returnTransform.worldPosition : this.originalWorldPos);

        this.node.setWorldPosition(targetPos.x, targetPos.y, this.node.worldPosition.z);
        this.RestoreOriginalParent();
        this.RestoreOriginalSiblingIndex();
    }

    public RestoreOriginalParent() {
        if (this.originalParent && this.originalParent.isValid && this.node.parent !== this.originalParent) {
            const worldPos = this.node.worldPosition.clone();
            const worldScale = this.node.worldScale.clone();
            this.node.setParent(this.originalParent);
            this.node.setWorldPosition(worldPos);
            this.node.setWorldScale(worldScale);
        }
    }

    private RestoreOriginalSiblingIndex() {
        if (this.originalParent?.isValid && this.node.parent === this.originalParent
            && this.originalSiblingIndex >= 0 && this.originalSiblingIndex < this.originalParent.children.length) {
            this.node.setSiblingIndex(this.originalSiblingIndex);
        }
    }

    public CanDrag(): boolean {
        // Do not start a new drag while this item is tweening back after a
        // failed drop. Otherwise onBeginDrag events can be invoked repeatedly
        // by rapid taps (for example Spoon triggering Food's "Get" animation).
        if (!this.enabled || !this.isDraggable || this.isReturningToStart) return false;
        
        // Auto-heal stuck returning flags if not currently tweening
        if (this.isForceReturningToStart && !this.isDraggingSession) {
            this.isForceReturningToStart = false;
        }
        return true;
    }

    /** Sets the accepted drop type from the Item component on the supplied node. */
    public SetTargetItemType(target: Node | null) {
        const targetItem = target?.getComponent('Item') as Item | null;
        if (!targetItem) {
            console.warn(`[ItemDraggable] Item component not found on target for ${this.node.name}.`);
            return;
        }
        this.item.itemMoveToTarget.defaultTarget = target;
        this.targetItemType = targetItem.itemType;
    }

    private ResetScale() {
        Tween.stopAllByTarget(this.node);
        // The drag layer normally has a different scale from the item's
        // original parent (for example after zooming the gameplay node).
        // Restore that parent before applying the saved *local* scale,
        // otherwise Cocos converts it against the drag layer and the item
        // returns at an incorrect size.
        this.RestoreOriginalParent();
        this.node.setScale(this.originalScale);
    }

    private SetShadowActive(isActive: boolean) {
        if (this.shadowObject) {
            this.shadowObject.active = isActive;
        }
    }

    private PlayBeginDragSound() {
        if (!this.playBeginDragSound) return;
        Ply_SoundManager.Ins.PlayFx(this.beginDragFxType);
    }

    private PlayReturnToStartFinishSound() {
        if (!this.playReturnToStartFinishSound) return;
        Ply_SoundManager.Ins.PlayFx(this.returnToStartFinishFxType);
    }

    private HidePanBubbleHint(target: Node): void {
        let current: Node | null = target;
        while (current) {
            const pan = current.getComponent('Pan') as any;
            if (pan?.HideBubbleHintForSuccessfulDrop) {
                pan.HideBubbleHintForSuccessfulDrop();
                return;
            }
            current = current.parent;
        }
    }

    private FinalizeFailedDrag(spawnHeart: boolean) {
        this.isForceReturningToStart = false;
        this.isReturningToStart = false;
        this.RestoreOriginalParent();
        // Always finish with the item's original local scale. This covers
        // returnTransform/cached-position flows, which reparent only here.
        this.node.setScale(this.originalScale);
        this.RestoreOriginalSiblingIndex();
        this.SetShadowActive(true);
        this.PlayReturnToStartFinishSound();
        this.onReturnToStartComplete.invoke();

        if (spawnHeart && this.item) {
            this.item.OnDragFailReturnComplete();
        }
    }

    private OnReturnToStartComplete() {
        this.FinalizeFailedDrag(this.spawnHeartOnReturnComplete);
        this.spawnHeartOnReturnComplete = true;

        if (this.enableDraggableOnReturnComplete) {
            this.enableDraggableOnReturnComplete = false;
            this.EnableComponent();
        }
    }
}
