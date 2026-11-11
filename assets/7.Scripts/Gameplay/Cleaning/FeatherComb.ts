import { _decorator, Enum, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { SpineBoneFollower } from '../Effects/SpineBoneFollower';

const { ccclass, property } = _decorator;

class FeatherState {
    public picked = false;
    public dropped = false;
    constructor(public readonly node: Node) { }
}

/**
 * Lược chải lông: Brush Point chạm vào lông nào thì lông đó dính vào lược.
 * Thả lược ra thì toàn bộ lông đang dính rơi xuống và mờ dần.
 * Chải và thả hết lông thì bước hoàn thành.
 */
@ccclass('FeatherComb')
export class FeatherComb extends Item {
    @property({ type: Node, tooltip: 'Đầu lược dùng để nhặt lông. Để trống sẽ dùng node FeatherComb.' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính nhặt lông quanh Brush Point (world units/pixels).' })
    public pickRadius = 70;

    @property({ type: [Node], tooltip: 'Các node lông cần chải.' })
    public feathers: Node[] = [];

    @property({ type: Node, tooltip: 'Node cha của lông khi rơi. Để trống sẽ dùng node cha ban đầu của lược.' })
    public fallLayer: Node | null = null;

    @property({ tooltip: 'Khoảng rơi theo trục Y (world).' })
    public fallDistanceY = 350;

    @property({ min: 0.05, tooltip: 'Thời gian rơi + mờ dần (giây).' })
    public fallDuration = 0.9;

    @property({ tooltip: 'Phát âm thanh khi nhặt được lông.' })
    public playPickSound = true;

    @property({ type: Enum(FxType), tooltip: 'Âm thanh khi nhặt được lông.' })
    public pickFxType: FxType = FxType.Clean2;

    @property({ type: ItemCleanManager, tooltip: 'Manager điều phối lượt; lược chỉ chải khi có onProcess.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi đã chải và thả hết lông.' })
    public onAllFeathersCleared: Ply_Event = new Ply_Event();

    private states: FeatherState[] = [];
    private isCombing = false;
    private hasPickedInCurrentDrag = false;
    private readonly brushWorldPos = new Vec3();
    private readonly tempPos = new Vec3();

    private readonly boundOnDragStart = () => this.onDragStart();
    private readonly boundOnRelease = () => this.onRelease();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.fallLayer ??= this.node.parent;
        this.states = this.feathers.filter(n => !!n && n.isValid).map(n => new FeatherState(n));
    }

    protected onEnable(): void {
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.itemDraggable?.onBeginDrag.addListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.addListener(this.boundOnRelease);
        this.itemDraggable?.onDropFail.addListener(this.boundOnRelease);
    }

    protected onDisable(): void {
        this.itemDraggable?.onBeginDrag.removeListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.removeListener(this.boundOnRelease);
        this.itemDraggable?.onDropFail.removeListener(this.boundOnRelease);
        this.isCombing = false;
    }

    /** Lông kế tiếp chưa được chải, dùng cho HandTut. */
    public GetHandTutTarget(): Node | null {
        return this.states.find(s => !s.picked && s.node.activeInHierarchy)?.node ?? null;
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem() || this.isDone) return;
        this.isCombing = true;
        this.hasPickedInCurrentDrag = false;
    }

    protected lateUpdate(): void {
        if (!this.isCombing) return;
        if (this.itemDraggable && !this.itemDraggable.IsDragging) {
            this.onRelease();
            return;
        }

        const brush = this.brushPoint || this.node;
        brush.getWorldPosition(this.brushWorldPos);
        const radiusSq = this.pickRadius * this.pickRadius;
        for (const state of this.states) {
            if (state.picked || !state.node.activeInHierarchy) continue;
            state.node.getWorldPosition(this.tempPos);
            const dx = this.tempPos.x - this.brushWorldPos.x;
            const dy = this.tempPos.y - this.brushWorldPos.y;
            if (dx * dx + dy * dy <= radiusSq) this.pick(state, brush);
        }
    }

    private pick(state: FeatherState, brush: Node): void {
        state.picked = true;
        this.hasPickedInCurrentDrag = true;
        const node = state.node;
        const follower = node.getComponent(SpineBoneFollower);
        if (follower) follower.enabled = false;
        Tween.stopAllByTarget(node);
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(node.worldPosition);

        node.setParent(brush, true);
        // Kéo nhẹ lông về sát đầu lược cho cảm giác bị dính vào.
        const target = new Vec3(node.position.x * 0.35, node.position.y * 0.35, 0);
        tween(node).to(0.12, { position: target }, { easing: 'quadOut' }).start();
        if (this.playPickSound) Ply_SoundManager.Ins?.PlayFx(this.pickFxType);
    }

    private onRelease(): void {
        if (!this.isCombing) return;
        this.isCombing = false;

        const layer = this.fallLayer?.isValid ? this.fallLayer : this.node.parent;
        for (const state of this.states) {
            if (!state.picked || state.dropped) continue;
            state.dropped = true;
            this.dropFeather(state.node, layer);
        }

        if (!this.isDone && this.states.length > 0 && this.states.every(s => s.dropped)) {
            this.isDone = true;
            this.onAllFeathersCleared.invoke();
            (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
        }
    }

    private dropFeather(node: Node, layer: Node | null): void {
        Tween.stopAllByTarget(node);
        if (layer) node.setParent(layer, true);

        const world = node.worldPosition.clone();
        const end = new Vec3(world.x + (Math.random() - 0.5) * 80, world.y - this.fallDistanceY, world.z);
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);

        tween(node)
            .to(this.fallDuration, { worldPosition: end, angle: node.angle + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 50) }, { easing: 'sineIn' })
            .call(() => { node.active = false; })
            .start();
        tween(opacity).delay(this.fallDuration * 0.35).to(this.fallDuration * 0.65, { opacity: 0 }).start();
    }

    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    public OnDragFailReturnComplete(): void {
        if (!this.hasPickedInCurrentDrag) super.OnDragFailReturnComplete();
    }

    public SpawnBreakHeart(): void {
        if (!this.hasPickedInCurrentDrag) super.SpawnBreakHeart();
    }
}
