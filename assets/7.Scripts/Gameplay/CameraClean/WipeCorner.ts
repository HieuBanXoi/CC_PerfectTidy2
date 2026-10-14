import { _decorator, Node, Tween, tween, UIOpacity, Vec3, Enum } from 'cc';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CameraCleanTool } from './CameraCleanTool';

const { ccclass, property } = _decorator;

/**
 * Bước 5a: xé góc gói giấy ướt (wipe_Corner).
 * Kéo đủ xa rồi thả: góc giấy rơi xuống, xoay và mờ dần. Kéo chưa đủ: về chỗ cũ.
 */
@ccclass('WipeCorner')
export class WipeCorner extends CameraCleanTool {
    @property({ min: 0, tooltip: 'Khoảng cách kéo (world) để xé được góc.' })
    public tearDistance = 150;

    @property({ min: 0, tooltip: 'Quãng rơi (world).' })
    public fallDistance = 600;

    @property({ min: 0.01, tooltip: 'Thời gian rơi + mờ (giây).' })
    public fallDuration = 0.6;

    @property({ type: Node, tooltip: 'Điểm HandTut chỉ tới khi gợi ý xé góc (ví dụ cuối đường nét đứt).' })
    public hintTarget: Node | null = null;

    @property({ type: Node, tooltip: 'Điểm HandTut bắt đầu (ví dụ đầu đường nét đứt). Để trống: node góc.' })
    public hintStart: Node | null = null;

    @property({ type: Enum(FxType), tooltip: 'Sound khi xé được.' })
    public tearFxType: FxType = FxType.Wipe;

    @property({ type: Node, tooltip: 'Đường nét đứt chỉ chỗ xé (TearLine). Xé xong sẽ mờ dần rồi tắt.' })
    public tearGuide: Node | null = null;

    private _torn = false;
    private _detached = false;

    /** Góc đã được xé rời (đang rơi hoặc đã biến mất). */
    public get IsDetached(): boolean {
        return this._detached || !this.node.activeInHierarchy;
    }

    /** Bóc được bất kỳ lúc nào trước lượt của nó. */
    protected get CanWorkWhenNotCurrent(): boolean {
        return !this.IsDetached;
    }

    protected onStepStart(): void {
        // Đã bóc sẵn từ trước thì lượt này tự xong.
        if (this.IsDetached) this.scheduleOnce(() => this.Complete(), 0);
    }

    /** HandTut: vuốt dọc theo đường nét đứt (từ hintStart tới hintTarget). */
    public GetHandTutStart(): Node | null {
        return this.hintStart;
    }

    protected getHintTarget(): Node | null {
        return this.hintTarget;
    }

    protected onToolDrag(): boolean {
        if (!this._torn && Vec3.distance(this.node.worldPosition, this._dragStartWorld) >= this.tearDistance) {
            this._torn = true;
            Ply_SoundManager.Ins?.PlayFx(this.tearFxType);
        }
        // Đã kéo đi một đoạn thì không tính là thả sai.
        return this._torn || Vec3.distance(this.node.worldPosition, this._dragStartWorld) > 20;
    }

    protected onToolDragStart(): void {
        // Bắt đầu kéo góc thì tắt nét đứt luôn.
        this.hideTearGuide(0.1);
    }

    protected onToolDropFail(): boolean {
        // Thả khi chưa xé được: hiện lại nét đứt để người chơi biết chỗ xé.
        if (!this._torn && !this._detached) this.showTearGuide();
        if (!this._torn || this._detached) return false;
        this._detached = true;
        this.hideTearGuide();
        this.itemDraggable?.ConsumeCurrentDropFail();
        this.fall();
        // Bóc trước lượt thì chỉ rơi; tới lượt sẽ tự xong.
        if (this.IsCurrentStep) this.Complete();
        return true;
    }

    private hideTearGuide(duration = 0.25): void {
        const guide = this.tearGuide;
        if (!guide?.activeInHierarchy) return;
        const opacity = guide.getComponent(UIOpacity) ?? guide.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        tween(opacity)
            .to(duration, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => { guide.active = false; })
            .start();
    }

    private showTearGuide(): void {
        const guide = this.tearGuide;
        if (!guide?.isValid) return;
        const opacity = guide.getComponent(UIOpacity) ?? guide.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        guide.active = true;
        tween(opacity).to(0.2, { opacity: 255 }, { easing: 'sineOut' }).start();
    }

    private fall(): void {
        const node = this.node;
        const parentScale = Math.max(0.0001, Math.abs(node.parent?.worldScale.y ?? 1));
        const target = node.position.clone().add3f(60, -this.fallDistance / parentScale, 0);
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);

        Tween.stopAllByTarget(node);
        tween(node)
            .to(this.fallDuration, { position: target, angle: node.angle - 50 }, { easing: 'quadIn' })
            .start();
        tween(opacity)
            .delay(this.fallDuration * 0.3)
            .to(this.fallDuration * 0.7, { opacity: 0 })
            .call(() => { node.active = false; })
            .start();
    }
}
