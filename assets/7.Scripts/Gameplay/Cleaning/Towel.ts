import { _decorator, Node, Sprite, UITransform, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_Event } from '../Framework/Ply_Event';

const { ccclass, property } = _decorator;

/** Một frame lag (load prefab, spawn particle...) có thể trả dt rất lớn; giới hạn lại để fade không nhảy thẳng về 0. */
const MAX_FADE_STEP = 1 / 30;

class TowelTargetState {
    public cleanTime = 0;
    public isFaded = false;
    public readonly sprite: Sprite | null;
    public readonly initialOpacity: number;
    public readonly transform: UITransform | null;

    constructor(public readonly node: Node) {
        // Fade from the Sprite's authored alpha, not a generated UIOpacity.
        // A generated/stale UIOpacity can be zero and make the target vanish
        // on its first contact even though Required Fade Time is longer.
        this.sprite = node.getComponent(Sprite) ?? node.getComponentInChildren(Sprite);
        this.initialOpacity = this.sprite?.color.a ?? 255;
        this.transform = node.getComponent(UITransform);
    }
}

/** Wipes target sprites away progressively as the towel passes across them. */
@ccclass('Towel')
export class Towel extends Item {
    @property({ type: Node, tooltip: 'Đầu khăn dùng để kiểm tra target. Để trống sẽ dùng node Towel.' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính lau tại brushPoint (world units/pixels). Được cộng thêm vào vùng UITransform của target.' })
    public wipeRadius = 30;

    @property({ type: [Node], tooltip: 'Danh sách target sprite cần được lau mờ.' })
    public targetNodes: Node[] = [];

    @property({ min: 0.1, tooltip: 'Thời gian Brush Point cần ở trên mỗi target để lau mờ hoàn toàn (giây).' })
    public requiredFadeTime = 2;

    @property({ type: ItemCleanManager, tooltip: 'Manager điều phối lượt; Towel chỉ lau khi có onProcess.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi một target đã được lau sạch hoàn toàn.' })
    public onTargetFaded: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi mọi target đã được lau sạch.' })
    public onAllTargetsFaded: Ply_Event = new Ply_Event();

    private targetStates: TowelTargetState[] = [];
    private isDraggingTowel = false;
    private hasWipedTargetInCurrentDrag = false;
    private brushWorldPosition = new Vec3();
    private targetWorldPosition = new Vec3();
    private brushLocalPosition = new Vec3();

    private readonly boundOnDragStart = () => this.onDragStart();
    private readonly boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.initializeTargets();
    }

    protected onEnable(): void {
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.itemDraggable?.onBeginDrag.addListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.addListener(this.boundOnDragEnd);
        this.itemDraggable?.onDropFail.addListener(this.boundOnDragEnd);
        this.itemDraggable?.onReturnToStartComplete.addListener(this.boundOnDragEnd);
    }

    protected onDisable(): void {
        this.itemDraggable?.onBeginDrag.removeListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.removeListener(this.boundOnDragEnd);
        this.itemDraggable?.onDropFail.removeListener(this.boundOnDragEnd);
        this.itemDraggable?.onReturnToStartComplete.removeListener(this.boundOnDragEnd);
        this.isDraggingTowel = false;
    }

    public initializeTargets(): void {
        this.targetStates = this.targetNodes
            .filter((node): node is Node => !!node && node.isValid)
            .map(node => new TowelTargetState(node));
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem() || this.isDone) return;

        this.isDraggingTowel = true;
        this.hasWipedTargetInCurrentDrag = false;
    }

    public onDragEnd(): void {
        this.isDraggingTowel = false;
    }

    protected lateUpdate(dt: number): void {
        if (!this.isDraggingTowel) return;
        if (!this.isCurrentCleanManagerItem() || (this.itemDraggable && !this.itemDraggable.IsDragging)) {
            this.onDragEnd();
            return;
        }
        this.checkTargets(dt);
    }

    private checkTargets(dt: number): void {
        const brush = this.brushPoint || this.node;
        brush.getWorldPosition(this.brushWorldPosition);

        // dt không hợp lệ hoặc quá lớn sẽ khiến progress nhảy thẳng lên 1 ngay frame đầu chạm target.
        const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_FADE_STEP) : 0;

        for (const state of this.targetStates) {
            if (state.isFaded || !state.node.isValid || !state.node.activeInHierarchy) continue;
            if (this.isBrushOverTarget(state)) this.updateTargetFade(state, step);
        }
    }

    /**
     * Kiểm tra theo vùng UITransform của target (cộng thêm wipeRadius) thay vì khoảng cách tới gốc node.
     * Sprite thường lệch khỏi gốc node (anchor/offset/kích thước lớn), nếu so theo gốc node thì thời gian
     * fade đã chạy từ lúc khăn còn ở xa, tới khi khăn chạm vào sprite thì nó đã mờ hết.
     */
    private isBrushOverTarget(state: TowelTargetState): boolean {
        const transform = state.transform && state.transform.isValid ? state.transform : null;
        if (transform) {
            transform.convertToNodeSpaceAR(this.brushWorldPosition, this.brushLocalPosition);
            const left = -transform.anchorX * transform.width - this.wipeRadius;
            const right = (1 - transform.anchorX) * transform.width + this.wipeRadius;
            const bottom = -transform.anchorY * transform.height - this.wipeRadius;
            const top = (1 - transform.anchorY) * transform.height + this.wipeRadius;
            return this.brushLocalPosition.x >= left && this.brushLocalPosition.x <= right
                && this.brushLocalPosition.y >= bottom && this.brushLocalPosition.y <= top;
        }

        state.node.getWorldPosition(this.targetWorldPosition);
        const dx = this.brushWorldPosition.x - this.targetWorldPosition.x;
        const dy = this.brushWorldPosition.y - this.targetWorldPosition.y;
        return dx * dx + dy * dy <= this.wipeRadius * this.wipeRadius;
    }

    private getRequiredFadeTime(): number {
        return Number.isFinite(this.requiredFadeTime) ? Math.max(0.1, this.requiredFadeTime) : 2;
    }

    private updateTargetFade(state: TowelTargetState, dt: number): void {
        this.hasWipedTargetInCurrentDrag = true;
        state.cleanTime += dt;

        const progress = Math.min(1, state.cleanTime / this.getRequiredFadeTime());
        if (state.sprite && state.sprite.isValid) {
            const color = state.sprite.color.clone();
            color.a = Math.round((1 - progress) * state.initialOpacity);
            state.sprite.color = color;
        }

        if (progress >= 1 && state.node.isValid) {
            state.isFaded = true;
            state.node.active = false;
            this.onTargetFaded.invoke();
            this.tryCompleteTowel();
        }
    }

    private tryCompleteTowel(): void {
        if (!this.targetStates.every(state => state.isFaded)) return;

        this.isDone = true;
        this.onAllTargetsFaded.invoke();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
    }

    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    public OnDragFailReturnComplete(): void {
        if (!this.hasWipedTargetInCurrentDrag) super.OnDragFailReturnComplete();
    }

    public SpawnBreakHeart(): void {
        if (!this.hasWipedTargetInCurrentDrag) super.SpawnBreakHeart();
    }
}
