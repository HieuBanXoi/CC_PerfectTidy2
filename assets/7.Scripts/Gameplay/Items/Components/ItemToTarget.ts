import { _decorator, Animation, Node } from 'cc';
import { HandTutManager } from '../../Systems/HandTutManager';
import { Item } from './Item';
import { ItemMoveToTarget } from './ItemMoveToTarget';
import { ItemType } from './ItemType';

const { ccclass, property } = _decorator;

@ccclass('ItemToTargetAnimation')
export class ItemToTargetAnimation {
    @property({ tooltip: 'Parameter/trigger name for an Animation Controller. Leave empty to skip.' })
    public controllerTrigger: string = '';

    @property({ tooltip: 'Clip index on a regular Animation component. Use -1 to skip.' })
    public animationClipIndex: number = -1;
}

/**
 * Moves this item to a fixed target after a successful drop, then plays the
 * configured arrival animations on this item and/or its target item.
 */
@ccclass('ItemToTarget')
export class ItemToTarget extends Item {
    @property(Node)
    public targetPosition: Node = null!;

    @property(Item)
    public targetItem: Item | null = null;

    @property({ type: ItemToTargetAnimation, tooltip: 'Animation to play on this item after it arrives.' })
    public itemArrivalAnimation: ItemToTargetAnimation = new ItemToTargetAnimation();

    @property({ type: ItemToTargetAnimation, tooltip: 'Animation to play on Target Item after this item arrives.' })
    public targetItemArrivalAnimation: ItemToTargetAnimation = new ItemToTargetAnimation();

    @property({ tooltip: 'Immediately hide this item after a successful drop instead of moving it.' })
    public disableItemWhenDrop: boolean = false;

    @property({ tooltip: 'Mark this Item complete and remove it from the hand tutorial after arrival.' })
    public itemDoneWhenArrive: boolean = false;

    @property({ tooltip: 'After this item\'s regular Animation clip finishes, call DoneAnimation() (mark done and return without heart).' })
    public doneAnimationWhenItemAnimationFinished: boolean = true;

    private waitingForMoveComplete = false;
    private animationWaitingForDone: Animation | null = null;

    private readonly onDropSuccess = () => this.MoveToCurrentTarget();
    private readonly onMoveComplete = () => {
        if (this.waitingForMoveComplete) this.HandleMoveComplete();
    };

    protected onLoad(): void {
        super.onLoad();
    }

    protected onEnable(): void {
        this.cacheComponents();
        this.subscribeMovementEvents();
    }

    protected onDisable(): void {
        this.unsubscribeMovementEvents();
        this.stopWaitingForItemAnimation();
        this.waitingForMoveComplete = false;
    }

    public MoveToCurrentTarget(): void {
        if (!this.enabled || this.waitingForMoveComplete) return;

        if (this.disableItemWhenDrop) {
            this.HandleMoveComplete();
            this.node.active = false;
            return;
        }

        if (!this.itemMoveToTarget || !this.targetPosition) {
            console.warn(`[ItemToTarget] Assign ItemMoveToTarget and Target Position on "${this.node.name}".`);
            return;
        }

        this.waitingForMoveComplete = true;
        this.itemMoveToTarget.ExecuteMove2D(this.targetPosition);
    }

    public HandleMoveComplete(): void {
        if (this.waitingForMoveComplete) this.waitingForMoveComplete = false;

        this.itemDraggable?.DisableComponent();
        this.playItemArrivalAnimation();
        this.playAnimation(this.targetItem, this.targetItemArrivalAnimation);
        this.itemDraggable.targetItemType = ItemType.None;
        if (this.itemDoneWhenArrive) {
            this.ItemDone();
            HandTutManager.Ins?.ItemDone(this);
        }
    }

    private subscribeMovementEvents(): void {
        this.itemDraggable?.onDropSuccess.removeListener(this.onDropSuccess);
        this.itemDraggable?.onDropSuccess.addListener(this.onDropSuccess);
        this.itemMoveToTarget?.node.off(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
        this.itemMoveToTarget?.node.on(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
    }

    private unsubscribeMovementEvents(): void {
        this.itemDraggable?.onDropSuccess.removeListener(this.onDropSuccess);
        this.itemMoveToTarget?.node.off(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
    }

    private playAnimation(item: Item | null, animation: ItemToTargetAnimation): void {
        if (!item || !animation) return;

        if (animation.controllerTrigger.trim()) {
            item.PlayTrigger(animation.controllerTrigger.trim());
            return;
        }

        if (animation.animationClipIndex >= 0) {
            item.PlayClipWithIndex(animation.animationClipIndex);
        }
    }

    private playItemArrivalAnimation(): void {
        const config = this.itemArrivalAnimation;
        if (!config) return;

        if (config.controllerTrigger.trim()) {
            this.PlayTrigger(config.controllerTrigger.trim());
            if (this.doneAnimationWhenItemAnimationFinished) {
                console.warn(`[ItemToTarget] AnimationController cannot emit a generic finish event. Add an Animation Graph event that calls DoneAnimation() on "${this.node.name}".`);
            }
            return;
        }

        if (config.animationClipIndex < 0) return;

        const animationComponent = this.animationComponent;
        const clip = animationComponent?.clips[config.animationClipIndex];
        if (!animationComponent || !clip) {
            this.PlayClipWithIndex(config.animationClipIndex);
            return;
        }

        if (this.doneAnimationWhenItemAnimationFinished) {
            this.stopWaitingForItemAnimation();
            this.animationWaitingForDone = animationComponent;
            animationComponent.once(Animation.EventType.FINISHED, this.onItemAnimationFinished, this);
        }

        animationComponent.play(clip.name);
    }

    private readonly onItemAnimationFinished = (): void => {
        this.animationWaitingForDone = null;
        if (this.isValid && this.node.activeInHierarchy) {
            this.DoneAnimation();
        }
    };

    private stopWaitingForItemAnimation(): void {
        this.animationWaitingForDone?.off(Animation.EventType.FINISHED, this.onItemAnimationFinished, this);
        this.animationWaitingForDone = null;
    }
}
