import { _decorator, Component, sp } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Bám node theo một bone của Spine để node đung đưa theo animation.
 * Node phải là con trực tiếp của node có sp.Skeleton. Vị trí/góc đặt trong
 * editor được giữ làm offset so với bone tại thời điểm start (setup pose).
 */
@ccclass('SpineBoneFollower')
export class SpineBoneFollower extends Component {
    @property({ type: sp.Skeleton, tooltip: 'Skeleton chứa bone. Để trống sẽ lấy sp.Skeleton ở node cha.' })
    public skeleton: sp.Skeleton | null = null;

    @property({ tooltip: 'Tên bone cần bám theo.' })
    public boneName = '';

    @property({ tooltip: 'Xoay node theo góc xoay của bone.' })
    public followRotation = true;

    private bone: sp.spine.Bone | null = null;
    private bound = false;
    private localX = 0;
    private localY = 0;
    private baseAngle = 0;
    private baseBoneRotation = 0;

    protected start(): void {
        this.skeleton ??= this.node.parent?.getComponent(sp.Skeleton) ?? null;
        // Apply animation hiện tại mà không tua thời gian: ở đầu game đây là frame 0 của
        // animation mặc định, đúng tư thế editor hiển thị lúc đặt node. Bind ngay tại đây để
        // không phụ thuộc dt của frame đầu (frame đầu có thể rất dài khi trang load chậm).
        if (this.skeleton?.enabledInHierarchy) {
            // Skeleton có thể chưa kịp set animation mặc định lúc này -> set sớm để pose đúng frame 0.
            const sk = this.skeleton;
            if (!sk.getCurrent(0) && sk.animation) sk.setAnimation(0, sk.animation, sk.loop);
            sk.updateAnimation(0);
            this.bindBone();
        }
    }

    protected onEnable(): void {
        // Node có thể được reparent ra ngoài (ví dụ lông dính vào lược) rồi tắt follower.
        if (this.bound) this.bindBone();
    }

    /** Ghi lại offset hiện tại của node so với bone. */
    public bindBone(): void {
        this.bound = true;
        this.bone = this.skeleton && this.boneName ? this.skeleton.findBone(this.boneName) : null;
        if (!this.bone) {
            if (this.boneName) console.warn(`[SpineBoneFollower] Bone "${this.boneName}" not found on ${this.node.name}.`);
            return;
        }

        const b = this.bone;
        const det = b.a * b.d - b.b * b.c;
        if (Math.abs(det) < 1e-6) {
            this.bone = null;
            return;
        }
        const dx = this.node.position.x - b.worldX;
        const dy = this.node.position.y - b.worldY;
        this.localX = (b.d * dx - b.b * dy) / det;
        this.localY = (-b.c * dx + b.a * dy) / det;
        this.baseAngle = this.node.angle;
        this.baseBoneRotation = b.getWorldRotationX();
    }

    protected lateUpdate(): void {
        // Dự phòng: skeleton chưa sẵn sàng lúc start thì bind ở frame đầu.
        if (!this.bound) {
            this.bindBone();
            return;
        }
        const b = this.bone;
        if (!b) return;

        const pos = this.node.position;
        this.node.setPosition(
            b.a * this.localX + b.b * this.localY + b.worldX,
            b.c * this.localX + b.d * this.localY + b.worldY,
            pos.z,
        );
        if (this.followRotation) {
            this.node.angle = this.baseAngle + (b.getWorldRotationX() - this.baseBoneRotation);
        }
    }
}
