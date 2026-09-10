import { _decorator, Node, ParticleSystem2D, Vec3 } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_Event } from '../Framework/Ply_Event';

const { ccclass, property } = _decorator;

class SoapTargetState {
    public hitCount = 0;
    public isActivated = false;
    public wasInsideInLastFrame = false;

    constructor(public readonly node: Node) { }
}

/**
 * Drag soap over target nodes. Each completed target is activated and plays
 * its own ParticleSystem2D (or the first ParticleSystem2D found below it).
 */
@ccclass('SoapAdd')
export class SoapAdd extends Item {
    @property({ type: Node, tooltip: 'Đầu quét xà phòng. Để trống sẽ dùng node SoapAdd.' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính quét xà phòng tại brushPoint (world units/pixels).' })
    public soapRadius = 30;

    @property({ type: [Node], tooltip: 'Các điểm target để brush quét qua và kích hoạt xà phòng.' })
    public targetNodes: Node[] = [];

    @property({ min: 1, step: 1, tooltip: 'Số lần brush đi vào target để kích hoạt particle.' })
    public hitsToActivate = 1;

    @property({ type: ParticleSystem2D, tooltip: 'Particle trail ở đầu SoapAdd. Tự lấy ParticleSystem2D con của Brush Point nếu để trống.' })
    public trailParticle: ParticleSystem2D | null = null;

    @property({ type: ItemCleanManager, tooltip: 'Manager điều phối lượt; chỉ hoạt động khi SoapAdd có onProcess.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi sau khi một target được kích hoạt particle.' })
    public onTargetActivated: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi tất cả target đã được kích hoạt.' })
    public onAllTargetsActivated: Ply_Event = new Ply_Event();

    private targetStates: SoapTargetState[] = [];
    private isDraggingSoap = false;
    private hasActivatedTargetInCurrentDrag = false;
    private isTrailPlaying = false;
    private brushWorldPosition = new Vec3();
    private targetWorldPosition = new Vec3();

    private readonly boundOnDragStart = () => this.onDragStart();
    private readonly boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.trailParticle ??= this.brushPoint?.getComponentInChildren(ParticleSystem2D) ?? null;
        this.initializeTargets();
        this.stopTrailParticle();
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
        this.isDraggingSoap = false;
        this.stopTrailParticle();
    }

    public initializeTargets(): void {
        this.targetStates = this.targetNodes
            .filter((node): node is Node => !!node && node.isValid)
            .map(node => new SoapTargetState(node));
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem() || this.isDone) return;

        this.isDraggingSoap = true;
        this.hasActivatedTargetInCurrentDrag = false;
        this.startTrailParticle();
        for (const state of this.targetStates) {
            state.wasInsideInLastFrame = false;
        }
        this.checkTargets();
    }

    public onDragEnd(): void {
        this.isDraggingSoap = false;
        this.stopTrailParticle();
        for (const state of this.targetStates) {
            state.wasInsideInLastFrame = false;
        }
    }

    protected lateUpdate(): void {
        if (!this.isDraggingSoap) return;
        if (!this.isCurrentCleanManagerItem() || (this.itemDraggable && !this.itemDraggable.IsDragging)) {
            this.onDragEnd();
            return;
        }
        this.checkTargets();
    }

    private checkTargets(): void {
        const brush = this.brushPoint || this.node;
        brush.getWorldPosition(this.brushWorldPosition);
        const radiusSq = this.soapRadius * this.soapRadius;

        for (const state of this.targetStates) {
            if (state.isActivated || !state.node.isValid) continue;

            state.node.getWorldPosition(this.targetWorldPosition);
            const dx = this.brushWorldPosition.x - this.targetWorldPosition.x;
            const dy = this.brushWorldPosition.y - this.targetWorldPosition.y;
            const isInside = dx * dx + dy * dy <= radiusSq;
            if (isInside && !state.wasInsideInLastFrame) {
                this.hitTarget(state);
            }
            state.wasInsideInLastFrame = isInside;
        }
    }

    private hitTarget(state: SoapTargetState): void {
        state.hitCount++;
        this.hasActivatedTargetInCurrentDrag = true;
        if (state.hitCount < Math.max(1, this.hitsToActivate)) return;

        state.isActivated = true;
        state.node.active = true;
        const particle = state.node.getComponent(ParticleSystem2D) ?? state.node.getComponentInChildren(ParticleSystem2D);
        if (particle) {
            particle.node.active = true;
            particle.resetSystem();
        } else {
            console.warn(`[SoapAdd] Target "${state.node.name}" has no ParticleSystem2D.`);
        }

        this.onTargetActivated.invoke();
        if (this.targetStates.every(target => target.isActivated)) {
            this.isDone = true;
            this.onAllTargetsActivated.invoke();
            (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
        }
    }

    private startTrailParticle(): void {
        if (!this.trailParticle) return;

        this.trailParticle.node.active = true;
        this.trailParticle.enabled = true;
        this.trailParticle.duration = -1;
        this.trailParticle.autoRemoveOnFinish = false;
        if (this.isTrailPlaying) return;

        this.trailParticle.resetSystem();
        this.isTrailPlaying = true;
    }

    private stopTrailParticle(): void {
        if (!this.trailParticle) return;
        this.trailParticle.stopSystem();
        this.isTrailPlaying = false;
    }

    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /** Không hiện BreakHeart khi lượt kéo vừa rồi đã soap trúng ít nhất một target. */
    public OnDragFailReturnComplete(): void {
        if (!this.hasActivatedTargetInCurrentDrag) {
            super.OnDragFailReturnComplete();
        }
    }

    public SpawnBreakHeart(): void {
        if (!this.hasActivatedTargetInCurrentDrag) {
            super.SpawnBreakHeart();
        }
    }
}
