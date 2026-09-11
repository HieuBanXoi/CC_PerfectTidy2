import { _decorator, Color, Enum, input, Input, Node, Sprite, Tween, tween, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemType } from '../Items/Components/ItemType';
import { ItemStirring } from '../Items/Components/ItemStirring';
import { Ply_Singleton } from '../Framework/Ply_Singleton';

const { ccclass, property } = _decorator;

export enum TypeHind {
    None = 0,
    Click,
    Drag,
    Stir,
}
Enum(TypeHind);

/** Optional target collections exposed by the cleaning-item components. */
interface HandTutTargetProvider extends Item {
    GetHandTutTarget?: () => Node | null;
    cleanTarget?: Node | null;
    cleanTargetStep2?: Node | null;
    targetNodes?: Node[];
    hairTargets?: Node[];
    targets?: Array<{ targetNode?: Node | null }>;
}

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
    @property({ min: 0.01, tooltip: 'Thời gian mờ dần của tay khi chạm đích trước khi lặp lại.' })
    public hintFadeOutDuration = 0.25;
    @property public clickScaleMultiplier = 1.25;

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
    // Optional one-shot destination for the first hint of a specific item.
    // ItemCleanManager uses this for Clipper so its opening gesture points at
    // the cleaned object, while subsequent hints use the tool's hair target.
    // It is consumed on the player's first interaction with that item, not on
    // render: the first render happens on frame 1 and is usually hidden by the
    // first tap before the player has seen it.
    private firstHintItem: Item | null = null;
    private firstHintTarget: Node | null = null;
    private consecutiveDropFails = 0;
    private forceNoDelay = false;
    private handDefaultScale = new Vec3(1, 1, 1);
    private handDefaultAlpha = 255;
    @property({ type: Sprite, tooltip: 'Optional Sprite component on the hand node for alpha fading.' })
    public handSprite: Sprite | null = null;
    private handDefaultColor = new Color(255, 255, 255, 255);
    private currentHintToken = 0;
    private activeAuxTween: Tween<object> | null = null;
    private activeFadeTween: Tween<object> | null = null;
    private boundItems = new Set<Item>();

    protected onLoad(): void {
        super.onLoad();
        if (this.handNode) {
            Vec3.copy(this.handDefaultScale, this.handNode.scale);
            if (this.handSprite) {
                this.handSprite = this.handNode.getComponentInChildren(Sprite);
                
            }
            this.handDefaultColor = this.handSprite.color.clone();
                this.handDefaultAlpha = this.handDefaultColor.a;
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
            && (!this.currentItemHandTut.node.activeInHierarchy || this.currentItemHandTut.isDone)) {
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

    /**
     * Replaces the tutorial order with the active gameplay sequence.
     * Duplicate entries are preserved because a single tool can be used for
     * more than one sequential step.
     */
    public SetTutorialItems(items: readonly Item[]): void {
        this.items = items.filter((item): item is Item => !!item && item.isValid);
        this.bindConfiguredItems();

        if (this.currentItemHandTut && !this.items.includes(this.currentItemHandTut)) {
            this.hideHandTut();
        }
    }

    /**
     * Sets the drag destination used by the hand hint for the supplied active
     * item. Cleaning tools expose their actionable areas as target collections;
     * use the first visible target because ItemMoveToTarget has one default
     * destination at a time.
     */
    public SetDefaultTargetForItem(item: Item | null): void {
        const moveToTarget = item?.itemMoveToTarget;
        if (!item || !moveToTarget) return;

        const preferredTarget = this.firstHintItem === item && this.isUsableTarget(this.firstHintTarget)
            ? this.firstHintTarget
            : null;
        const target = preferredTarget ?? this.getActiveTarget(item);
        if (target) moveToTarget.defaultTarget = target;
    }

    /**
     * Overrides one tutorial destination for the next hint of an item. The
     * override is consumed as soon as that item's hint is shown.
     */
    public SetFirstTutorialTarget(item: Item | null, target: Node | null): void {
        this.firstHintItem = item?.isValid ? item : null;
        this.firstHintTarget = target?.isValid ? target : null;
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
        this.consumeFirstTutorialTarget(item);
        this.RegisterCorrectAction();
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
            item.itemDraggable?.onBeginDrag.addListener(() => this.OnGameplayDragBegin(item));
            item.itemDraggable?.onDropSuccess.addListener(() => this.RegisterCorrectAction());
            item.itemDraggable?.onDropFail.addListener(() => this.RegisterBreakHeartDropFail());
            item.itemStirring?.onStirComplete.addListener(() => this.RegisterCorrectAction());
        }
    }

    private OnGameplayDragBegin(item: Item): void {
        this.consumeFirstTutorialTarget(item);
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
            return;
        }

        this.SetDefaultTargetForItem(item);

        if (this.isClickableReady(item)) {
            this.playClickHint(item.node);
            this.currentItemHandTut = item;
            this.TypeHind = TypeHind.Click;
        } else if (this.isDraggableReady(item) && this.hasValidDragTarget(item)) {
            this.playMoveHint(item.node, item.itemMoveToTarget!.defaultTarget);
            this.currentItemHandTut = item;
            this.TypeHind = TypeHind.Drag;
        } else if (this.isStirringReady(item)) {
            this.playStirringHint(item.itemStirring!);
            this.currentItemHandTut = item;
            this.TypeHind = TypeHind.Stir;
        }
    }

    private consumeFirstTutorialTarget(item: Item): void {
        if (this.firstHintItem !== item) return;
        this.firstHintItem = null;
        this.firstHintTarget = null;

        // The one-shot destination is for the visual hint only. Once the
        // player has started using the item, restore the component's real
        // cleaning target so later hints use Clipper's current hair target.
        const actualTarget = this.getActiveTarget(item);
        if (actualTarget && item.itemMoveToTarget) {
            item.itemMoveToTarget.defaultTarget = actualTarget;
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
        // A repeated sequence entry can be marked done after its first step,
        // then become the active item again for a later step.  Its onProcess
        // flag is the authoritative signal that it is ready for that turn.
        if (!item || (item.isDone && !item.onProcess) || !item.node.activeInHierarchy) return false;

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
        const target = item.itemMoveToTarget?.defaultTarget;
        const draggable = item.itemDraggable;
        if (!target || !target.isValid || !draggable) return false;
        if (!item.requireMatchingTargetTypeForHandTut) return true;

        const targetItem = target.getComponent(Item);
        return !!targetItem && targetItem.itemType === draggable.targetItemType;
    }

    /** Finds the target relevant to the item's current cleaning turn. */
    private getActiveTarget(item: Item): Node | null {
        const provider = item as HandTutTargetProvider;

        const componentTarget = provider.GetHandTutTarget?.();
        if (this.isUsableTarget(componentTarget)) return componentTarget;

        // Shower is intentionally present twice in ItemCleanManager. Its
        // completed first turn means the second target should be used.
        if (provider.cleanTarget) {
            const showerTarget = item.isDone && item.onProcess
                ? provider.cleanTargetStep2 || provider.cleanTarget
                : provider.cleanTarget;
            if (this.isUsableTarget(showerTarget)) return showerTarget;
        }

        const collectionTarget = [
            ...(provider.targetNodes ?? []),
            ...(provider.hairTargets ?? []),
            ...(provider.targets ?? []).map(target => target?.targetNode ?? null),
        ].find(target => this.isUsableTarget(target));

        return collectionTarget ?? null;
    }

    private isUsableTarget(target: Node | null | undefined): target is Node {
        return !!target && target.isValid && target.activeInHierarchy;
    }

    private isStirringReady(item: Item): boolean {
        return !!item.itemStirring?.enabled && !item.itemStirring.IsDone;
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

    private playMoveHint(start: Node, end: Node): void {
        const token = this.prepareHand(start.worldPosition);
        // Re-read both positions every loop: the first hint starts on frame 1,
        // before layout/zoom has settled, and items can move while it repeats.
        const loop = () => {
            if (!this.isHintCurrent(token) || !start.isValid || !end.isValid) return;
            this.handNode.setWorldPosition(start.worldPosition);
            this.setHandAlpha(this.handDefaultAlpha);
            tween(this.handNode)
                .to(this.moveDuration, { worldPosition: end.worldPosition.clone() }, { easing: 'sineInOut' })
                .call(() => this.fadeOutThenLoop(token, loop))
                .start();
        };
        loop();
    }

    private fadeOutThenLoop(token: number, loop: () => void): void {
        if (!this.isHintCurrent(token)) return;

        if (!this.handSprite) {
            this.setHandAlpha(0);
            this.scheduleOnce(() => {
                if (this.isHintCurrent(token)) loop();
            }, this.waitAtEndDuration);
            return;
        }

        const fadeState = { alpha: this.handDefaultAlpha };
        this.activeFadeTween = tween(fadeState)
            .to(this.hintFadeOutDuration, { alpha: 0 }, {
                easing: 'sineIn',
                onUpdate: () => this.setHandAlpha(fadeState.alpha),
            })
            .delay(this.waitAtEndDuration)
            .call(() => {
                this.activeFadeTween = null;
                if (this.isHintCurrent(token)) loop();
            })
            .start();
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
        this.shownCount++;
        this.hasShownFirstHint = true;
        this.forceNoDelay = false;
        return this.currentHintToken;
    }

    private hideHandTut(): void {
        this.currentHintToken++;
        this.currentItemHandTut = null;
        this.TypeHind = TypeHind.None;
        this.activeAuxTween?.stop();
        this.activeAuxTween = null;
        this.activeFadeTween?.stop();
        this.activeFadeTween = null;
        if (!this.handNode) return;
        Tween.stopAllByTarget(this.handNode);
        this.handNode.setScale(this.handDefaultScale);
        this.setHandAlpha(this.handDefaultAlpha);
        this.handNode.active = false;
    }

    private isHintCurrent(token: number): boolean {
        return !!this.handNode?.isValid && this.handNode.activeInHierarchy && token === this.currentHintToken;
    }

    private setHandAlpha(alpha: number): void {
        if (!this.handSprite) return;
        const color = this.handSprite.color;
        color.set(this.handDefaultColor.r, this.handDefaultColor.g, this.handDefaultColor.b, alpha);
        this.handSprite.color = color;
    }

    private getCurrentDelay(): number {
        if (this.forceNoDelay || this.shownCount < this.noDelayItemCount) return this.shortIdleDelay;
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
            // Keep completed references so duplicate entries can be reused by
            // a later ItemCleanManager turn. Candidate filtering above skips
            // completed items unless they are the current onProcess item.
            if (!this.items[i] || !this.items[i].isValid) this.items.splice(i, 1);
        }
    }
}
