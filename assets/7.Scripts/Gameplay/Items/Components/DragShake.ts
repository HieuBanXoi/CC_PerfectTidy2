import { _decorator, Component, Node, Vec3 } from 'cc';
import { ItemDraggable } from './ItemDraggable';

const { ccclass, property } = _decorator;

/** Rung nhẹ hình của tool trong lúc đang kéo (ví dụ vòi sen đang phun nước). */
@ccclass('DragShake')
export class DragShake extends Component {
    @property({ type: [Node], tooltip: 'Các node hình được rung. Để trống sẽ rung tất cả node con có Sprite.' })
    public visuals: Node[] = [];

    @property({ tooltip: 'Góc rung tối đa (độ).' })
    public angle = 2.5;

    @property({ tooltip: 'Độ lệch vị trí tối đa (local).' })
    public offset = 4;

    @property({ tooltip: 'Góc rung (độ) áp lên chính node tool (lắc cả tool quanh tâm của nó). 0 = tắt.' })
    public selfAngle = 0;

    @property({ tooltip: 'Tốc độ rung (rad/giây).' })
    public speed = 45;

    private draggable: ItemDraggable | null = null;
    private dragging = false;
    private time = 0;
    private selfBaseAngle = 0;
    private readonly bases = new Map<Node, { pos: Vec3; angle: number }>();
    private readonly onBegin = () => this.setDragging(true);
    private readonly onEnd = () => this.setDragging(false);

    protected onLoad(): void {
        if (this.visuals.length === 0) {
            this.visuals = this.node.children.filter(c => !!c.getComponent('cc.Sprite'));
        }
        for (const v of this.visuals) {
            if (v?.isValid) this.bases.set(v, { pos: v.position.clone(), angle: v.angle });
        }
    }

    protected onEnable(): void {
        this.draggable ??= this.getComponent(ItemDraggable);
        this.draggable?.onBeginDrag.addListener(this.onBegin);
        this.draggable?.onDropSuccess.addListener(this.onEnd);
        this.draggable?.onDropFail.addListener(this.onEnd);
    }

    protected onDisable(): void {
        this.draggable?.onBeginDrag.removeListener(this.onBegin);
        this.draggable?.onDropSuccess.removeListener(this.onEnd);
        this.draggable?.onDropFail.removeListener(this.onEnd);
        this.setDragging(false);
    }

    private setDragging(value: boolean): void {
        if (value && !this.dragging) this.selfBaseAngle = this.node.angle;
        if (!value && this.dragging && this.selfAngle !== 0) this.node.angle = this.selfBaseAngle;
        this.dragging = value;
        this.time = 0;
        if (!value) {
            for (const [v, b] of this.bases) {
                if (!v.isValid) continue;
                v.setPosition(b.pos);
                v.angle = b.angle;
            }
        }
    }

    protected update(dt: number): void {
        if (!this.dragging) return;
        this.time += dt;
        const t = this.time * this.speed;
        const a = Math.sin(t) * this.angle;
        const ox = Math.sin(t * 1.3) * this.offset;
        const oy = Math.cos(t * 0.9) * this.offset * 0.5;
        if (this.selfAngle !== 0) this.node.angle = this.selfBaseAngle + Math.sin(t * 0.8) * this.selfAngle;
        for (const [v, b] of this.bases) {
            if (!v.isValid) continue;
            v.setPosition(b.pos.x + ox, b.pos.y + oy, b.pos.z);
            v.angle = b.angle + a;
        }
    }
}
