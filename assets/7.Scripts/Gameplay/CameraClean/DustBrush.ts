import { _decorator, Node, Tween, tween, UIOpacity, UITransform, Vec3, Enum } from 'cc';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CameraCleanTool } from './CameraCleanTool';

const { ccclass, property } = _decorator;

/**
 * Bước 1: cọ quét các hạt bụi (Dusts) của mặt hiện tại.
 * Khi kéo cọ sẽ phe phẩy (xoay qua lại). Hạt bụi bị quét văng theo hướng cọ và mờ dần.
 */
@ccclass('DustBrush')
export class DustBrush extends CameraCleanTool {
    @property({ type: Node, tooltip: 'Node hình cọ để phe phẩy (xoay). Để trống: không phe phẩy.' })
    public brushVisual: Node | null = null;

    @property({ min: 0, tooltip: 'Bán kính quét (world) cộng thêm nửa kích thước hạt bụi.' })
    public sweepRadius = 40;

    @property({ tooltip: 'Góc phe phẩy tối đa (độ).' })
    public wobbleAngle = 14;

    @property({ min: 0, tooltip: 'Tốc độ phe phẩy.' })
    public wobbleSpeed = 22;

    @property({ min: 0, tooltip: 'Khoảng cách hạt bụi văng ra (world).' })
    public flyDistance = 120;

    @property({ min: 0.01, tooltip: 'Thời gian hạt bụi văng + mờ (giây).' })
    public flyDuration = 0.35;

    @property({ type: Enum(FxType), tooltip: 'Sound mỗi khi quét trúng 1 hạt bụi.' })
    public hitFxType: FxType = FxType.Clean2;

    private _swept = new Set<Node>();
    private _finishing = false;
    private _wobbleTime = 0;
    private _baseAngle = 0;
    private readonly _dir = new Vec3();

    protected onLoad(): void {
        super.onLoad();
        this._baseAngle = this.brushVisual?.angle ?? 0;
    }

    protected onStepStart(): void {
        this._swept.clear();
        this._finishing = false;
        if (this.getRemainingDusts().length === 0) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        return this.getRemainingDusts()[0] ?? null;
    }

    protected onToolDragStart(): void {
        this._wobbleTime = 0;
        if (this.brushVisual) Tween.stopAllByTarget(this.brushVisual);
    }

    protected onToolDrag(dt: number): boolean {
        Vec3.subtract(this._dir, this._point, this._lastPoint);
        const moved = this._dir.length();
        const isMoving = moved > 0.5;

        if (this.brushVisual && isMoving) {
            this._wobbleTime += dt;
            this.brushVisual.angle = this._baseAngle + Math.sin(this._wobbleTime * this.wobbleSpeed) * this.wobbleAngle;
        }

        let hit = false;
        for (const dust of this.getRemainingDusts()) {
            const transform = dust.getComponent(UITransform);
            const size = transform ? Math.max(transform.width, transform.height) * Math.abs(dust.worldScale.x) * 0.5 : 0;
            if (Vec3.distance(this._point, dust.worldPosition) > this.sweepRadius + size) continue;
            this.sweepDust(dust, isMoving ? this._dir.clone().multiplyScalar(1 / moved) : null);
            hit = true;
        }

        if (!this._finishing && this.getRemainingDusts().length === 0) {
            this._finishing = true;
            this.scheduleOnce(() => this.Complete(), this.flyDuration * 0.6);
        }
        return isMoving || hit;
    }

    protected onToolDragEnd(): void {
        if (!this.brushVisual) return;
        Tween.stopAllByTarget(this.brushVisual);
        tween(this.brushVisual).to(0.15, { angle: this._baseAngle }, { easing: 'sineOut' }).start();
    }

    private getRemainingDusts(): Node[] {
        return (this.Face?.Dusts ?? []).filter(d => d.activeInHierarchy && !this._swept.has(d));
    }

    private sweepDust(dust: Node, direction: Vec3 | null): void {
        this._swept.add(dust);
        Ply_SoundManager.Ins?.PlayFx(this.hitFxType);

        const dir = direction ?? new Vec3(Math.random() - 0.5, Math.random() - 0.5, 0).normalize();
        const parentScale = Math.max(0.0001, Math.abs(dust.parent?.worldScale.x ?? 1));
        const offset = dir.multiplyScalar(this.flyDistance / parentScale);
        const target = dust.position.clone().add(offset);
        const opacity = dust.getComponent(UIOpacity) ?? dust.addComponent(UIOpacity);

        Tween.stopAllByTarget(dust);
        tween(dust)
            .to(this.flyDuration, { position: target, angle: dust.angle + (Math.random() > 0.5 ? 180 : -180) }, { easing: 'quadOut' })
            .start();
        tween(opacity)
            .to(this.flyDuration, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => { dust.active = false; })
            .start();
    }
}
