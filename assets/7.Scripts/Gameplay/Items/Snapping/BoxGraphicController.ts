import { _decorator, Component, sp } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('BoxGraphicController')
export class BoxGraphicController extends Component {

    @property({
        type: sp.Skeleton,
        tooltip: 'Tham chiếu tới component sp.Skeleton của Box (nếu để trống sẽ tự động lấy)'
    })
    public skeletonAnimation: sp.Skeleton | null = null;

    protected onLoad(): void {
        if (!this.skeletonAnimation) {
            this.skeletonAnimation = this.getComponent(sp.Skeleton) || this.getComponentInChildren(sp.Skeleton);
        }
    }

    /**
     * Thay đổi animation Spine của Box và gọi callback khi animation hoàn thành
     */
    public ChangeAnim(animString: string, loop: boolean = false, onComplete?: () => void): void {
        if (!this.skeletonAnimation) {
            console.warn('⚠️ [BoxGraphicController] Chưa gắn sp.Skeleton component!', this.node.name);
            onComplete?.();
            return;
        }

        try {
            const trackEntry = this.skeletonAnimation.setAnimation(0, animString, loop);

            if (!loop && onComplete) {
                const duration = (trackEntry && trackEntry.animation) ? trackEntry.animation.duration : 0.5;
                this.scheduleOnce(() => {
                    onComplete();
                }, duration);
            }
        } catch (e) {
            console.error(`❌ [BoxGraphicController] Lỗi khi play anim '${animString}':`, e);
            onComplete?.();
        }
    }
}
