import { _decorator, Color, Component, Graphics, Vec2 } from 'cc';

const { ccclass, property, requireComponent } = _decorator;

/**
 * Vẽ đường nét đứt (Graphics) theo danh sách điểm local, ví dụ đường xé của gói khăn ướt.
 * Có thể cho nét chạy dọc đường (marchSpeed) để gây chú ý.
 */
@ccclass('DashedLine')
@requireComponent(Graphics)
export class DashedLine extends Component {
    @property({ type: [Vec2], tooltip: 'Các điểm của đường (local), nối lần lượt.' })
    public points: Vec2[] = [];

    @property({ min: 1, tooltip: 'Độ dài mỗi nét.' })
    public dashLength = 12;

    @property({ min: 0, tooltip: 'Khoảng hở giữa 2 nét.' })
    public gapLength = 8;

    @property({ min: 0.5, tooltip: 'Độ dày nét.' })
    public lineWidth = 4;

    @property({ tooltip: 'Màu nét.' })
    public color: Color = new Color(255, 255, 255, 255);

    @property({ tooltip: 'Tốc độ nét chạy dọc đường (đơn vị/giây). 0 = đứng yên.' })
    public marchSpeed = 30;

    private _graphics: Graphics | null = null;
    private _offset = 0;

    protected onLoad(): void {
        this._graphics = this.getComponent(Graphics);
        this.Redraw();
    }

    protected update(dt: number): void {
        if (this.marchSpeed === 0) return;
        const period = this.dashLength + this.gapLength;
        this._offset = (this._offset + this.marchSpeed * dt) % Math.max(1, period);
        this.Redraw();
    }

    public Redraw(): void {
        const g = this._graphics ?? this.getComponent(Graphics);
        if (!g) return;
        g.clear();
        g.lineWidth = this.lineWidth;
        g.strokeColor = this.color;
        g.lineCap = Graphics.LineCap.ROUND;

        const period = Math.max(1, this.dashLength + this.gapLength);
        // Vị trí trong chu kỳ nét/hở, dịch theo _offset để nét chạy dọc đường.
        let phase = (period - this._offset) % period;

        for (let i = 0; i < this.points.length - 1; i++) {
            const a = this.points[i];
            const b = this.points[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length <= 0) continue;
            const ux = dx / length;
            const uy = dy / length;

            let travelled = 0;
            while (travelled < length) {
                const inDash = phase < this.dashLength;
                const remainInPhase = inDash ? this.dashLength - phase : period - phase;
                const step = Math.min(remainInPhase, length - travelled);
                if (inDash) {
                    g.moveTo(a.x + ux * travelled, a.y + uy * travelled);
                    g.lineTo(a.x + ux * (travelled + step), a.y + uy * (travelled + step));
                }
                travelled += step;
                phase = (phase + step) % period;
            }
        }
        g.stroke();
    }
}
