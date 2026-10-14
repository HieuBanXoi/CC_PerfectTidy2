import { _decorator, Component, Tween, tween, Vec3 } from 'cc';
import { CameraFace } from './CameraFace';

const { ccclass, property } = _decorator;

/**
 * Quản lý mặt máy ảnh đang làm sạch. Làm xong 1 mặt: máy ảnh punch nhẹ rồi bật mặt tiếp theo.
 */
@ccclass('CameraFaceController')
export class CameraFaceController extends Component {
    public static Ins: CameraFaceController | null = null;

    @property({ type: [CameraFace], tooltip: 'Các mặt theo thứ tự làm (Back trước, Front sau).' })
    public faces: CameraFace[] = [];

    @property({ tooltip: 'Hệ số phóng to khi punch.' })
    public punchScale = 1.08;

    @property({ min: 0.01, tooltip: 'Thời gian mỗi nửa punch (giây).' })
    public punchDuration = 0.12;

    private _currentIndex = 0;
    private _baseScale = new Vec3(1, 1, 1);
    private _isSwitching = false;

    public get CurrentFace(): CameraFace | null {
        return this.faces[this._currentIndex] ?? null;
    }

    public get IsSwitching(): boolean {
        return this._isSwitching;
    }

    protected onLoad(): void {
        CameraFaceController.Ins = this;
        Vec3.copy(this._baseScale, this.node.scale);
        this.faces.forEach((face, index) => {
            if (face?.isValid) face.node.active = index === this._currentIndex;
        });
    }

    protected onDestroy(): void {
        if (CameraFaceController.Ins === this) CameraFaceController.Ins = null;
    }

    /** Punch nhẹ rồi bật mặt kế tiếp. Không còn mặt nào thì gọi onDone ngay. */
    public SwitchToNextFace(onDone?: () => void): void {
        const next = this.faces[this._currentIndex + 1];
        if (!next?.isValid || this._isSwitching) {
            onDone?.();
            return;
        }

        this._isSwitching = true;
        const base = this._baseScale;
        const up = new Vec3(base.x * this.punchScale, base.y * this.punchScale, base.z);
        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(this.punchDuration, { scale: up }, { easing: 'quadOut' })
            .to(this.punchDuration, { scale: base }, { easing: 'quadIn' })
            .call(() => {
                this.CurrentFace && (this.CurrentFace.node.active = false);
                this._currentIndex++;
                next.node.active = true;
                // Nảy nhẹ khi mặt mới xuất hiện.
                this.node.setScale(base.x * 0.94, base.y * 0.94, base.z);
            })
            .to(0.2, { scale: base }, { easing: 'backOut' })
            .call(() => {
                this._isSwitching = false;
                onDone?.();
            })
            .start();
    }
}
