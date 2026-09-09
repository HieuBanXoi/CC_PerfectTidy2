import { _decorator } from 'cc';
import { Item } from '../Components/Item';
import { ItemDragChildRotator } from '../Components/ItemDragChildRotator';
import { ItemDraggable } from '../Components/ItemDraggable';
import { ItemMoveToTarget } from '../Components/ItemMoveToTarget';
import { ItemStirring } from '../Components/ItemStirring';
import { ItemType } from '../Components/ItemType';

const { ccclass } = _decorator;

/**
 * A reusable spatula workflow:
 * drag successfully -> move to its configured target -> stir -> return home.
 */
@ccclass('Spatula')
export class Spatula extends Item {
    private dragChildRotator: ItemDragChildRotator | null = null;
    private isMovingToTarget = false;
    private isStirringAtTarget = false;

    private readonly onDropSuccess = (): void => this.MoveToTarget();
    private readonly onMoveComplete = (): void => {
        if (this.isMovingToTarget) this.StartStir();
    };
    private readonly onStirComplete = (): void => this.FinishStir();

    protected onLoad(): void {
        super.onLoad();
        this.dragChildRotator = this.getComponent(ItemDragChildRotator);
    }

    protected onEnable(): void {
        this.cacheComponents();
        this.dragChildRotator ??= this.getComponent(ItemDragChildRotator);

        this.itemDraggable?.onDropSuccess.removeListener(this.onDropSuccess);
        this.itemDraggable?.onDropSuccess.addListener(this.onDropSuccess);
        this.itemMoveToTarget?.node.off(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
        this.itemMoveToTarget?.node.on(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
        this.itemStirring?.onStirComplete.removeListener(this.onStirComplete);
        this.itemStirring?.onStirComplete.addListener(this.onStirComplete);

        // Stirring must only be interactable after the spatula arrives.
        if (!this.isStirringAtTarget) this.itemStirring?.DisableComponent();
    }

    protected onDisable(): void {
        this.itemDraggable?.onDropSuccess.removeListener(this.onDropSuccess);
        this.itemMoveToTarget?.node.off(ItemMoveToTarget.EVENT_COMPLETE, this.onMoveComplete, this);
        this.itemStirring?.onStirComplete.removeListener(this.onStirComplete);
        this.isMovingToTarget = false;
        this.isStirringAtTarget = false;
    }

    /** Called automatically after a successful ItemDraggable drop. */
    public MoveToTarget(): void {
        if (this.isMovingToTarget || this.isStirringAtTarget) return;
        if (!this.itemMoveToTarget?.defaultTarget) {
            console.warn(`[Spatula] Assign ItemMoveToTarget.defaultTarget on "${this.node.name}".`);
            return;
        }

        this.isMovingToTarget = true;
        this.itemDraggable?.DisableComponent();
        this.itemMoveToTarget.ExecuteMove();
    }

    /** Enables stirring after the move finishes. The first player touch starts it. */
    public StartStir(): void {
        if (!this.isMovingToTarget) return;

        this.isMovingToTarget = false;
        this.isStirringAtTarget = true;
        this.itemDraggable?.DisableComponent();

        const stirring = this.itemStirring;
        if (!stirring) {
            console.warn(`[Spatula] ItemStirring is missing on "${this.node.name}".`);
            this.ReturnAfterStir();
            return;
        }

        stirring.EnableComponent();
        stirring.ResetStir();
        stirring.ShowStirringSprite();
    }

    /** Called by ItemStirring after its configured progress animation completes. */
    public FinishStir(): void {
        if (!this.isStirringAtTarget) return;

        this.isStirringAtTarget = false;
        this.itemStirring?.ShowIdleSprite();
        this.itemStirring?.EndStir();
        this.itemStirring?.DisableComponent();
        this.ReturnAfterStir();
    }

    private ReturnAfterStir(): void {
        // ReturnToStartWithoutHeart enables ItemDraggable only after the item
        // has returned to its original parent and position.
        this.itemDraggable?.ReturnToStartWithoutHeart();
        this.dragChildRotator?.RotateBack();
        this.itemDraggable.targetItemType = ItemType.None;
    }
}
