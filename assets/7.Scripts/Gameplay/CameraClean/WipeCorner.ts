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

    @property({ type: Node, tooltip: 'Điểm HandTut chỉ tới khi gợi ý xé góc.' })
    public hintTarget: Node | null = null;

    @property({ type: Enum(FxType), tooltip: 'Sound khi xé được.' })
    public tearFxType: FxType = FxType.Wipe;

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

    protected onToolDropFail(): boolean {
        if (!this._torn || this._detached) return false;
        this._detached = true;
        this.itemDraggable?.ConsumeCurrentDropFail();
        this.fall();
        // Bóc trước lượt thì chỉ rơi; tới lượt sẽ tự xong.
        if (this.IsCurrentStep) this.Complete();
        return true;
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
