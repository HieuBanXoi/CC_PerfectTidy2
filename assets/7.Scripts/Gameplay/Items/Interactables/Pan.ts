import { _decorator, Node, Tween, tween, Vec3 } from 'cc';
import { Item } from '../Components/Item';
import { ItemType } from '../Components/ItemType';
import { Sprite } from 'cc';
import { SpriteFrame } from 'cc';
import { Spatula } from './Spatula';
import { ItemDraggable } from '../Components/ItemDraggable';
import { HandTutManager } from '../../Systems/HandTutManager';
import { FxType, Ply_SoundManager } from '../../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

/** One item in a Pan step, with its optional BubbleHint visual. */
@ccclass('PanStepItem')
export class PanStepItem {
    @property({ type: Item, tooltip: 'Item that may be dropped on the Pan during this step.' })
    public item: Item | null = null;

    @property({ type: Node, tooltip: 'Sprite node displayed inside BubbleHint for this item. Leave empty for Spatula.' })
    public bubbleHintSprite: Node | null = null;
}

@ccclass('PanStep')
export class PanStep {
    @property({ type: [PanStepItem], tooltip: 'Items required for this step and their BubbleHint sprites.' })
    public stepItems: PanStepItem[] = [];
}

@ccclass('Pan')
export class Pan extends Item {

    @property({ type: Node, tooltip: 'Visual node shown while the pan is hot.' })
    public fireStove: Node = null!;

    @property({ type: Node, tooltip: 'Visual node shown while the pan is smoking.' })
    public smokeFX: Node = null!;

    @property({type: Node })
    public offNode: Node = null!;

    @property({type: Node })
    public onNode: Node = null!;

    @property({ type: Node, tooltip: 'Hint bubble shown with a zoom animation.' })
    public BubbleHint: Node | null = null;

    @property({ min: 0.01, tooltip: 'Duration of BubbleHint show/hide zoom.' })
    public bubbleHintZoomDuration = 0.25;

    @property({ type: Spatula, tooltip: 'Spatula to return after the Pan stirring animation completes.' })
    public spatula: Spatula | null = null;

    @property({ type: [PanStep], tooltip: 'Drop steps. Only items in the active step can target this Pan.' })
    public steps: PanStep[] = [];

    @property({ tooltip: 'Start the first configured step when TurnOn() is called.' })
    public startStepsWhenTurnedOn = true;

    private currentStepIndex = -1;
    private readonly completedItems = new Set<Item>();
    private readonly itemDropListeners = new Map<Item, (target: Node) => void>();
    private bubbleHintTween: Tween<Node> | null = null;
    private activeBubbleHintSprite: Node | null = null;
    private suppressedHandTutItem: Item | null = null;
    private pendingHandTutBubble: Node | null = null;

    onLoad() {
        super.onLoad();
        this.itemType = ItemType.None;
        if (this.fireStove && this.smokeFX) {
            this.fireStove.active = false;
            this.smokeFX.active = false;
        }
        if (this.offNode && this.onNode) {
            this.offNode.active = true;
            this.onNode.active = false;
        }
        if (this.BubbleHint) {
            this.BubbleHint.active = false;
            this.BubbleHint.setScale(0, 0, 1);
        }
    }

    protected onEnable(): void {
        this.SubscribeStepItems();
    }

    protected onDisable(): void {
        this.UnsubscribeStepItems();
        this.bubbleHintTween?.stop();
        this.bubbleHintTween = null;
        this.activeBubbleHintSprite = null;
        this.pendingHandTutBubble = null;
    }

    protected update(): void {
        this.updateBubbleHintFromHandTut();
    }

    public TurnOn(): void {
        this.itemType = ItemType.Pan;

        if (this.fireStove && this.smokeFX) {
            this.fireStove.active = true;
            this.smokeFX.active = true;
        }
        if (this.offNode && this.onNode) {
            this.offNode.active = false;
            this.onNode.active = true;
        }

        if (this.startStepsWhenTurnedOn) this.StartSteps();
    }

    /** Shows BubbleHint and zooms it from scale 0 to 1. */
    public ShowBubbleHint(spriteNode: Node | null = null): void {
        const bubble = this.BubbleHint;
        if (!bubble) return;

        // Animation Events may call ShowBubbleHint() without a sprite node.
        // Keep the sprite state configured by that animation in this case.
        if (spriteNode) this.setActiveBubbleHintSprite(spriteNode);
        this.bubbleHintTween?.stop();
        bubble.active = true;
        bubble.setScale(0, 0, 1);
        this.bubbleHintTween = tween(bubble)
            .to(this.bubbleHintZoomDuration, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .call(() => this.bubbleHintTween = null)
            .start();
    }

    /** Hides BubbleHint by zooming it from scale 1 to 0. */
    public HideBubbleHint(): void {
        const bubble = this.BubbleHint;
        if (!bubble || !bubble.active) return;

        this.bubbleHintTween?.stop();
        this.bubbleHintTween = tween(bubble)
            .to(this.bubbleHintZoomDuration, { scale: new Vec3(0, 0, 1) }, { easing: 'backIn' })
            .call(() => {
                bubble.active = false;
                this.bubbleHintTween = null;
            })
            .start();
        this.activeBubbleHintSprite = null;
    }

    /** Called by ItemDraggable whenever an item is successfully dropped on this Pan. */
    public HideBubbleHintForSuccessfulDrop(): void {
        const handTutItem = HandTutManager.Ins?.currentItemHandTut as Item | null;
        if (handTutItem) this.suppressedHandTutItem = handTutItem;
        this.pendingHandTutBubble = null;
        this.HideBubbleHint();
    }

    /**
     * Shows the first BubbleHint configured for the current (next) PanStep.
     * Call this from an Animation Event; HandTut still uses its normal delay.
     */
    public ShowNextStepBubbleHint(): void {
        const hint = this.getFirstBubbleHintForCurrentStep();
        if (!hint) return;

        this.suppressedHandTutItem = null;
        this.pendingHandTutBubble = hint;
        this.ShowBubbleHint(hint);
    }

    /**
     * Animation Event callback for the final frame of Pan's Stir clip.
     * Assign the Spatula reference in the Inspector.
     */
    public CompleteStir(): void {
        if (!this.spatula) {
            console.warn(`[Pan] Assign Spatula on "${this.node.name}" before calling CompleteStir.`);
            return;
        }

        this.spatula.FinishStir();
    }

    /** Starts the configured drop-step sequence from its first incomplete step. */
    public StartSteps(): void {
        if (this.currentStepIndex >= 0) return;
        this.SubscribeStepItems();
        this.ActivateStep(0);
    }

    /** Clears all step state and disables Pan targeting for every configured item. */
    public ResetSteps(): void {
        this.DisableAllStepTargets();
        this.completedItems.clear();
        this.currentStepIndex = -1;
    }

    /** Allows an Animation/EventHandler to advance to the next configured step. */
    public StartNextStep(): void {
        if (this.currentStepIndex < 0) return;
        this.CompleteCurrentStep();
    }

    private ActivateStep(index: number): void {
        this.DisableAllStepTargets();

        while (index < this.steps.length) {
            const step = this.steps[index];
            const validItems = step?.stepItems
                .map(stepItem => stepItem.item)
                .filter((item): item is Item => !!item && item.isValid) ?? [];
            if (validItems.length === 0) {
                index++;
                continue;
            }

            this.currentStepIndex = index;
            this.completedItems.clear();
            for (const item of validItems) {
                item.cacheComponents();
                if (!item.itemDraggable) {
                    console.warn(`[Pan] Step ${index + 1} item "${item.node.name}" needs ItemDraggable.`);
                    continue;
                }
                item.itemDraggable.targetItemType = ItemType.Pan;
            }
            return;
        }

        this.currentStepIndex = -1;
        this.completedItems.clear();
    }

    private CompleteCurrentStep(): void {
        if (this.currentStepIndex < 0) return;
        const completedIndex = this.currentStepIndex;
        this.DisableStepTargets(completedIndex);
        this.completedItems.clear();
        this.ActivateStep(completedIndex + 1);
    }

    private OnStepItemDropped(item: Item, target: Node): void {
        if (!this.isPanDropTarget(target)) return;

        this.HideBubbleHintForSuccessfulDrop();
        if (this.currentStepIndex < 0) return;

        const currentStep = this.steps[this.currentStepIndex];
        if (!currentStep?.stepItems.some(stepItem => stepItem.item === item) || this.completedItems.has(item)) return;

        this.completedItems.add(item);
        item.itemDraggable!.targetItemType = ItemType.None;
        // Tools such as the Spatula still need their follow-up stirring
        // interaction after they reach the pan. Marking them done here would
        // remove them from HandTutManager before that hint can be shown.
        item.cacheComponents();
        if (!item.itemStirring) item.ItemDone();

        const requiredItems = currentStep.stepItems
            .map(stepItem => stepItem.item)
            .filter((stepItem): stepItem is Item => !!stepItem && stepItem.isValid && !!stepItem.itemDraggable);
        if (requiredItems.every(stepItem => this.completedItems.has(stepItem))) {
            this.CompleteCurrentStep();
        }
    }

    private SubscribeStepItems(): void {
        for (const step of this.steps) {
            for (const stepItem of step?.stepItems ?? []) {
                const item = stepItem.item;
                if (!item || !item.isValid || this.itemDropListeners.has(item)) continue;
                item.cacheComponents();
                const draggable = item.itemDraggable;
                if (!draggable) continue;

                const listener = (target: Node) => this.OnStepItemDropped(item, target);
                this.itemDropListeners.set(item, listener);
                draggable.onDropSuccess.addListener(listener);
            }
        }
    }

    private UnsubscribeStepItems(): void {
        for (const [item, listener] of this.itemDropListeners) {
            item.itemDraggable?.onDropSuccess.removeListener(listener);
        }
        this.itemDropListeners.clear();
    }

    private DisableAllStepTargets(): void {
        for (let i = 0; i < this.steps.length; i++) {
            this.DisableStepTargets(i);
        }
    }

    private DisableStepTargets(index: number): void {
        for (const stepItem of this.steps[index]?.stepItems ?? []) {
            const item = stepItem.item;
            if (item?.isValid && item.itemDraggable) {
                item.itemDraggable.targetItemType = ItemType.None;
            }
        }
    }

    private updateBubbleHintFromHandTut(): void {
        if (!this.BubbleHint || this.currentStepIndex < 0) return;

        const handTutItem = HandTutManager.Ins?.currentItemHandTut as Item | null;
        // Keep the bubble visible while HandTut is waiting for its regular
        // idle delay. Once HandTut appears, normal matching takes over.
        if (this.pendingHandTutBubble) {
            if (!handTutItem) {
                if (!this.BubbleHint.active || this.activeBubbleHintSprite !== this.pendingHandTutBubble) {
                    this.ShowBubbleHint(this.pendingHandTutBubble);
                }
                return;
            }
            this.pendingHandTutBubble = null;
        }

        if (handTutItem && handTutItem === this.suppressedHandTutItem) {
            if (this.BubbleHint.active && !this.bubbleHintTween) this.HideBubbleHint();
            return;
        }
        this.suppressedHandTutItem = null;

        const hint = this.getBubbleHintForItem(handTutItem);
        if (!hint) {
            if (this.BubbleHint.active && !this.bubbleHintTween) this.HideBubbleHint();
            return;
        }

        if (this.BubbleHint.active && this.activeBubbleHintSprite === hint) return;
        this.ShowBubbleHint(hint);
    }

    private getBubbleHintForItem(item: Item | null): Node | null {
        if (!item || item === this.spatula) return null;

        const step = this.steps[this.currentStepIndex];
        return step?.stepItems.find(stepItem => stepItem.item === item)?.bubbleHintSprite ?? null;
    }

    private getFirstBubbleHintForCurrentStep(): Node | null {
        const step = this.steps[this.currentStepIndex];
        return step?.stepItems.find(stepItem =>
            !!stepItem.item
            && stepItem.item !== this.spatula
            && !stepItem.item.isDone
            && !!stepItem.bubbleHintSprite,
        )?.bubbleHintSprite ?? null;
    }

    private setActiveBubbleHintSprite(spriteNode: Node | null): void {
        for (const step of this.steps) {
            for (const stepItem of step?.stepItems ?? []) {
                if (stepItem.bubbleHintSprite) {
                    stepItem.bubbleHintSprite.active = stepItem.bubbleHintSprite === spriteNode;
                }
            }
        }
        this.activeBubbleHintSprite = spriteNode;
    }

    /** ItemDraggable has already validated the target; match its ItemType too. */
    private isPanDropTarget(target: Node | null): boolean {
        return target?.getComponent(Item)?.itemType === ItemType.Pan;
    }
}
