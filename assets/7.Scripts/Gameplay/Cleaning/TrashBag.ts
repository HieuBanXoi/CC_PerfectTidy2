import { _decorator, Component, Node, Tween, tween, UITransform, Vec3, Enum } from 'cc';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';

const { ccclass, property } = _decorator;

/**
 * Túi rác nhận rác từ SandShovel.
 * - ReceiveTrash: rác nhảy tới dropPos, scale về 0 rồi tắt.
 * - Close: tắt openNode, bật closeNode kèm hiệu ứng nảy.
 */
@ccclass('TrashBag')
export class TrashBag extends Component {
    @property({ type: Node, tooltip: 'Điểm rác rơi vào (TrashDropPos). Nên nằm giữa lớp sau và lớp trước của túi.' })
    public dropPos: Node | null = null;

    @property({ type: Node, tooltip: 'Node túi đang mở (TrashOpen).' })
    public openNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node túi đã đóng (TrashClose).' })
    public closeNode: Node | null = null;

    @property({ type: Node, tooltip: 'Vùng nhận rác (dùng UITransform). Để trống sẽ dùng node TrashBag.' })
    public receiveArea: Node | null = null;

    @property({ min: 0.01, tooltip: 'Thời gian rác nhảy vào túi (giây).' })
    public jumpDuration = 0.45;

    @property({ tooltip: 'Độ cao cung nhảy của rác (local units của dropPos).' })
    public jumpHeight = 180;

    @property({ tooltip: 'Hệ số nảy của túi mỗi khi nhận rác / khi đóng túi.' })
    public punchScale = 1.12;

    @property({ min: 0.01 })
    public punchDuration = 0.12;

    @property({ tooltip: 'Phát âm thanh khi rác bắt đầu bay vào túi.' })
    public playJumpSound = true;

    @property({ type: Enum(FxType) })
    public jumpFxType: FxType = FxType.Wipe;

    @property({ tooltip: 'Phát âm thanh khi rác rơi vào túi.' })
    public playReceiveSound = true;

    @property({ type: Enum(FxType) })
    public receiveFxType: FxType = FxType.PlaceTrash;

    @property({ tooltip: 'Phát âm thanh khi đóng túi.' })
    public playCloseSound = false;

    @property({ type: Enum(FxType) })
    public closeFxType: FxType = FxType.PlaceTrash;

    @property({ type: Ply_Event, tooltip: 'Gọi mỗi khi một rác rơi vào túi xong.' })
    public onTrashReceived: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi túi đã đóng xong.' })
    public onClosed: Ply_Event = new Ply_Event();

    private _baseScale: Vec3 | null = null;
    private readonly _tempLocal = new Vec3();

    protected onLoad(): void {
        this._baseScale = this.node.scale.clone();
        if (this.closeNode) this.closeNode.active = false;
        if (this.openNode) this.openNode.active = true;
    }

    public resetInEditor(): void {
        if (!this.onTrashReceived) this.onTrashReceived = new Ply_Event();
        if (!this.onClosed) this.onClosed = new Ply_Event();
    }

    /** Điểm world có nằm trong vùng nhận rác hay không. */
    public ContainsWorldPoint(worldPoint: Vec3): boolean {
        if (!this.node.activeInHierarchy) return false;
        const area = this.receiveArea?.isValid ? this.receiveArea : this.node;
        const transform = area.getComponent(UITransform);
        if (!transform) return false;

        transform.convertToNodeSpaceAR(worldPoint, this._tempLocal);
        const left = -transform.anchorX * transform.width;
        const bottom = -transform.anchorY * transform.height;
        return this._tempLocal.x >= left && this._tempLocal.x <= left + transform.width
            && this._tempLocal.y >= bottom && this._tempLocal.y <= bottom + transform.height;
    }

    /** Rác nhảy vào dropPos, scale về 0 rồi biến mất. */
    public ReceiveTrash(trash: Node, onComplete?: () => void): void {
        const target = this.dropPos?.isValid ? this.dropPos : this.node;
        Tween.stopAllByTarget(trash);
        trash.setParent(target, true);

        if (this.playJumpSound) Ply_SoundManager.Ins?.PlayFx(this.jumpFxType);

        const startPos = trash.position.clone();
        const startScale = trash.scale.clone();
        const state = { t: 0 };
        tween(state)
            .to(this.jumpDuration, { t: 1 }, {
                onUpdate: () => {
                    if (!trash.isValid) return;
                    const t = state.t;
                    const arc = this.jumpHeight * 4 * t * (1 - t);
                    trash.setPosition(startPos.x * (1 - t), startPos.y * (1 - t) + arc, startPos.z);
                    // Giữ kích thước gần như nguyên vẹn lúc bay, thu nhỏ dần khi tới nơi.
                    const s = 1 - t * t;
                    trash.setScale(startScale.x * s, startScale.y * s, startScale.z);
                },
            })
            .call(() => {
                if (trash.isValid) trash.active = false;
                if (this.playReceiveSound) Ply_SoundManager.Ins?.PlayFx(this.receiveFxType);
                this.punch();
                this.onTrashReceived.invoke(trash);
                onComplete?.();
            })
            .start();
    }

    /** Đóng túi: tắt TrashOpen, bật TrashClose kèm hiệu ứng nảy. */
    public Close(onComplete?: () => void): void {
        if (this.openNode) this.openNode.active = false;
        if (this.closeNode) this.closeNode.active = true;
        if (this.playCloseSound) Ply_SoundManager.Ins?.PlayFx(this.closeFxType);

        this.punch(() => {
            this.onClosed.invoke();
            onComplete?.();
        });
    }

    private punch(onComplete?: () => void): void {
        const base = this._baseScale ?? this.node.scale.clone();
        Tween.stopAllByTarget(this.node);
        this.node.setScale(base);
        tween(this.node)
            .to(this.punchDuration, { scale: new Vec3(base.x * this.punchScale, base.y * this.punchScale, base.z) }, { easing: 'sineOut' })
            .to(this.punchDuration, { scale: base }, { easing: 'sineIn' })
            .call(() => onComplete?.())
            .start();
    }
}
