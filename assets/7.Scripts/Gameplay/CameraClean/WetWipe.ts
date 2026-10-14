import { _decorator, Color, Enum, Node, Sprite, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CameraCleanTool } from './CameraCleanTool';
import { CameraFaceController } from './CameraFaceController';
import { WipeCorner } from './WipeCorner';

const { ccclass, property } = _decorator;

/**
 * Giấy ướt (wipe_Main) - dùng cho 2 loại lượt trong ItemCleanManager:
 * - Lượt rút giấy (khi chưa rút): kéo đủ xa -> Cover mờ dần; thả tay thì giấy về chỗ cũ -> xong lượt.
 * - Lượt lau (đã rút): chà lên các fingerprint của mặt hiện tại cho mờ hết.
 *   Xong mặt này -> CameraFaceController punch + đổi mặt -> xong lượt.
 * GlassCleaner gọi SetWet để giấy sẫm màu như bị ẩm.
 */
@ccclass('WetWipe')
export class WetWipe extends CameraCleanTool {
    @property({ type: Node, tooltip: 'Nắp gói giấy (wipe_Cover), mờ dần khi rút giấy ra.' })
    public cover: Node | null = null;

    @property({ type: WipeCorner, tooltip: 'Góc gói giấy (wipe_Corner). Phải bóc xong góc mới kéo được giấy.' })
    public corner: WipeCorner | null = null;

    @property({ min: 0, tooltip: 'Khoảng cách kéo (world) để tính là đã rút giấy.' })
    public pullDistance = 220;

    @property({ type: Enum(FxType), tooltip: 'Sound khi rút giấy ra đủ xa.' })
    public pullFxType: FxType = FxType.Wipe;

    @property({ type: Node, tooltip: 'Điểm HandTut chỉ tới khi gợi ý rút giấy.' })
    public pullHintTarget: Node | null = null;

    @property({ tooltip: 'Màu giấy khi ướt hoàn toàn.' })
    public wetColor: Color = new Color(150, 150, 160, 255);

    @property({ min: 0.05, tooltip: 'Thời gian chà trúng để 1 vết vân tay mờ hết (giây).' })
    public rubTimePerPrint = 0.6;

    @property({ min: 0, tooltip: 'Nới rộng vùng vân tay khi kiểm tra chà trúng (world).' })
    public rubPadding = 70;

    @property({ min: 0, tooltip: 'Lau xong 1 mặt: đợi heart hiện (giây) rồi mới punch + đổi mặt.' })
    public faceSwitchDelay = 0.8;

    private _switchFaceAfterDone = false;

    private _pulled = false;
    private _pullReached = false;
    private _finishing = false;
    private _wet = 0;
    private _baseColor: Color | null = null;
    private readonly _rub = new Map<Node, number>();
    private readonly _move = new Vec3();
    private _stepCount = 0;
    private _dryWarned = false;

    public get IsPulled(): boolean {
        return this._pulled;
    }

    /** Giấy đã lộ ra (rút đủ xa / đã rút) thì xịt ướt được. */
    public get CanBeWetted(): boolean {
        return this._pulled || this._pullReached;
    }

    public get Wet(): number {
        return this._wet;
    }

    public get IsFullyWet(): boolean {
        return this._wet >= 1;
    }

    protected onLoad(): void {
        super.onLoad();
        this._baseColor = this.spriteRenderer?.color.clone() ?? null;
    }

    /** Lượt hiện tại là lượt rút giấy (không spawn heart khi xong). */
    private _isPullStep = false;

    public ShouldSpawnHeartOnDone(): boolean {
        return !this._isPullStep && super.ShouldSpawnHeartOnDone();
    }

    public ShouldPlayDoneSound(): boolean {
        return !this._isPullStep && super.ShouldPlayDoneSound();
    }

    /** Rút giấy được trước lượt (khi đã bóc góc); lau thì phải đúng lượt. */
    protected get CanWorkWhenNotCurrent(): boolean {
        return !this._pulled && this.IsCornerOpened;
    }

    private get IsCornerOpened(): boolean {
        return !this.corner || this.corner.IsDetached;
    }

    protected update(): void {
        // Chưa bóc góc thì giấy chưa kéo ra được.
        const draggable = this.itemDraggable;
        const canDrag = this.IsCornerOpened;
        if (draggable && draggable.isDraggable !== canDrag && !draggable.IsDragging) draggable.isDraggable = canDrag;
    }

    protected onStepStart(): void {
        // Lượt đầu tiên của wipe_Main là lượt rút giấy, các lượt sau là lượt lau.
        this._isPullStep = this._stepCount === 0;
        this._stepCount++;
        this._finishing = false;
        this._rub.clear();
        if (this._isPullStep && this._pulled) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected onToolDragStart(): void {
        this._dryWarned = false;
    }

    protected getHintTarget(): Node | null {
        if (!this._pulled) return this.pullHintTarget;
        return this.getRemainingPrints()[0] ?? null;
    }

    /** 0 = khô, 1 = ướt hẳn (sẫm màu). */
    public SetWet(amount: number): void {
        this._wet = Math.max(0, Math.min(1, amount));
        const sprite = this.spriteRenderer ?? this.getComponent(Sprite);
        if (!sprite || !this._baseColor) return;
        const color = new Color();
        Color.lerp(color, this._baseColor, this.wetColor, this._wet);
        sprite.color = color;
    }

    protected onToolDrag(dt: number): boolean {
        if (!this._pulled) return this.updatePull();
        if (this._finishing) return false;
        // Giấy khô không lau được: chà lên máy ảnh thì báo BreakHeart (1 lần mỗi lượt kéo).
        if (!this.IsFullyWet) {
            this.warnDryWipe();
            return false;
        }

        Vec3.subtract(this._move, this._point, this._lastPoint);
        const isMoving = this._move.length() > 0.5;
        let rubbing = false;
        for (const print of this.getRemainingPrints()) {
            if (!this.isPointInside(this._point, print, this.rubPadding)) continue;
            rubbing = true;
            if (!isMoving) continue;
            const progress = Math.min(1, (this._rub.get(print) ?? 0) + dt / this.rubTimePerPrint);
            this._rub.set(print, progress);
            const opacity = print.getComponent(UIOpacity) ?? print.addComponent(UIOpacity);
            opacity.opacity = Math.round(255 * (1 - progress));
            if (progress >= 1) print.active = false;
        }

        if (this.getRemainingPrints().length === 0) this.finishFace();
        return rubbing && isMoving;
    }

    protected onToolDropFail(): boolean {
        if (this._pulled || !this._pullReached) return false;
        // Rút xong: thả tay thì giấy về chỗ cũ rồi xong lượt.
        this._pulled = true;
        const draggable = this.itemDraggable;
        if (draggable) {
            draggable.ConsumeCurrentDropFail();
            draggable.ReturnToStartWithoutHeart();
        }
        // Rút trước lượt thì chỉ rút; tới lượt rút sẽ tự xong.
        if (this.IsCurrentStep) this.Complete();
        return true;
    }

    private updatePull(): boolean {
        const distance = Vec3.distance(this.node.worldPosition, this._dragStartWorld);
        if (!this._pullReached && distance >= this.pullDistance) {
            this._pullReached = true;
            Ply_SoundManager.Ins?.PlayFx(this.pullFxType);
            this.fadeCover();
        }
        // Kéo ra một đoạn là đang thao tác đúng (thả sớm không BreakHeart).
        return distance > 20;
    }

    private warnDryWipe(): void {
        const camera = this.Face?.node.parent ?? null;
        if (this._dryWarned || !camera || !this.isPointInside(this._point, camera)) return;
        this._dryWarned = true;
        // Đã báo lỗi ở máy ảnh thì thả tay không báo thêm BreakHeart ở giấy.
        this._actedInDrag = true;
        this.Manager?.SpawnBreakHeartOnTarget(this, camera);
    }

    private fadeCover(): void {
        const cover = this.cover;
        if (!cover?.activeInHierarchy) return;
        const opacity = cover.getComponent(UIOpacity) ?? cover.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        tween(opacity)
            .to(0.35, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => { cover.active = false; })
            .start();
    }

    private finishFace(): void {
        if (this._finishing) return;
        this._finishing = true;
        this._switchFaceAfterDone = true;
        // Báo xong ngay để heart hiện trên mặt hiện tại; đổi mặt chạy trong PlayDoneTransition.
        this.Complete();
    }

    /**
     * ItemCleanManager gọi sau khi spawn heart: đợi heart hiện xong rồi punch + đổi mặt,
     * xong mới chuyển lượt. Trả về false nếu không cần đổi mặt.
     */
    public PlayDoneTransition(onDone: () => void): boolean {
        if (!this._switchFaceAfterDone) return false;
        this._switchFaceAfterDone = false;
        const controller = this.faceController ?? CameraFaceController.Ins;
        if (!controller) return false;
        this.scheduleOnce(() => controller.SwitchToNextFace(onDone), this.faceSwitchDelay);
        return true;
    }

    private getRemainingPrints(): Node[] {
        return (this.Face?.fingerprints ?? []).filter(p => p?.activeInHierarchy);
    }
}
