import { _decorator, Component, sp, UIOpacity } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Đồng bộ độ mờ của node (UIOpacity) sang alpha của một slot Spine.
 * Dùng cho các vết bẩn vẽ trong Spine (đúng layer giữa các bộ phận) nhưng được
 * điều khiển bởi node vùng va chạm. Node bị tắt thì slot ẩn hẳn.
 */
@ccclass('SpineSlotOpacityLink')
export class SpineSlotOpacityLink extends Component {
    @property({ type: sp.Skeleton, tooltip: 'Skeleton chứa slot. Để trống sẽ tìm sp.Skeleton ở các node cha.' })
    public skeleton: sp.Skeleton | null = null;

    @property({ tooltip: 'Tên slot cần đồng bộ alpha.' })
    public slotName = '';

    private slot: sp.spine.Slot | null = null;
    private baseAlpha = 1;
    private opacity: UIOpacity | null = null;

    protected start(): void {
        if (!this.skeleton) {
            let p = this.node.parent;
            while (p && !this.skeleton) {
                this.skeleton = p.getComponent(sp.Skeleton);
                p = p.parent;
            }
        }
        this.slot = this.skeleton && this.slotName ? this.skeleton.findSlot(this.slotName) : null;
        if (!this.slot && this.slotName) console.warn(`[SpineSlotOpacityLink] Slot "${this.slotName}" not found on ${this.node.name}.`);
        this.baseAlpha = this.slot?.data.color.a ?? 1;
    }

    protected lateUpdate(): void {
        if (!this.slot) return;
        this.opacity ??= this.getComponent(UIOpacity);
        const k = this.opacity ? this.opacity.opacity / 255 : 1;
        this.slot.color.a = this.baseAlpha * k;
    }

    protected onDisable(): void {
        if (this.slot) this.slot.color.a = 0;
    }
}
