import { _decorator, Enum, input, Input, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
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
    // The hand node is shared with ItemSpawnManager. Only touch it while this
    // manager is the one showing a hint, so the two never cancel each other.
    private isShowingHint = false;
    private idleDelayOverride = -1;
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
            && (!this.currentItemHandTut.node.activeInHierarchy || this.currentItemHandTut.isDone)) {
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
            this.playMoveHint(item.node, item.itemMoveToTarget!.defaultTarget);
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
        const target = item.itemMoveToTarget?.defaultTarget;
        const draggable = item.itemDraggable;
        if (!target || !target.isValid || !draggable) return false;
        if (!item.requireMatchingTargetTypeForHandTut) return true;

        const targetItem = target.getComponent(Item);
        return !!targetItem && targetItem.itemType === draggable.targetItemType;
    }

    private isStirringReady(item: Item): boolean {
        return !!item.itemStirring?.enabled && !item.itemStirring.IsDone;
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

    private playMoveHint(start: Node, end: Node): void {
        const token = this.prepareHand(start.worldPosition);
        const startPosition = start.worldPosition.clone();
        const endPosition = end.worldPosition.clone();
        const loop = () => {
            if (!this.isHintCurrent(token)) return;
            this.handNode.setWorldPosition(startPosition);
            this.setHandAlpha(this.handDefaultAlpha);
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
    }
}
