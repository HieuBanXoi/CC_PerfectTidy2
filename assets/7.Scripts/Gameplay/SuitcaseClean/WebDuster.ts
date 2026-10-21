import { _decorator, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { CameraCleanTool } from '../CameraClean/CameraCleanTool';

const { ccclass, property } = _decorator;

class WebState {
    public hits = 0;
    public inside = false;
    public fallen = false;
    public readonly restPosition = new Vec3();
    public restAngle = 0;
    constructor(public readonly node: Node) {
        Vec3.copy(this.restPosition, node.position);
        this.restAngle = node.angle;
    }
}

/**
 * Bước phủi mạng nhện (tool_2): mỗi lần chổi lau trúng web thì web rung lên,
 * lau đủ hitsToFall lần thì web rơi xuống. Tất cả web rơi hết thì xong bước.
 * 1 lần lau = chổi đi vào web; phải kéo ra ngoài hẳn web rồi vào lại mới tính lần tiếp theo.
 */
@ccclass('WebDuster')
export class WebDuster extends CameraCleanTool {
    @property({ type: [Node], tooltip: 'Các node mạng nhện (spider_web_1, 2, 3...).' })
    public webs: Node[] = [];

    @property({ min: 1, step: 1, tooltip: 'Số lần lau trúng để web rơi xuống.' })
    public hitsToFall = 3;

    @property({ tooltip: 'Nới rộng (dương) hoặc thu hẹp (âm) vùng chạm khi chổi đi vào web (world).' })
    public hitPadding = 0;

    @property({ tooltip: 'Chổi phải ra khỏi vùng này (web nới rộng thêm exitPadding, world) mới tính là đã ra ngoài hẳn.' })
    public exitPadding = 20;

    @property({ min: 0, tooltip: 'Góc rung (độ) mỗi lần lau trúng.' })
    public shakeAngle = 8;

    @property({ min: 0.01, tooltip: 'Thời gian rung (giây).' })
    public shakeDuration = 0.3;

    @property({ min: 0, tooltip: 'Quãng đường web rơi xuống (local).' })
    public fallDistance = 1200;

    @property({ min: 0.01, tooltip: 'Thời gian web rơi (giây).' })
    public fallDuration = 0.7;

    private _states: WebState[] = [];

    protected onLoad(): void {
        super.onLoad();
        this._states = this.webs.filter(web => !!web).map(web => new WebState(web));
    }

    protected onStepStart(): void {
        if (this._states.every(state => state.fallen)) this.scheduleOnce(() => this.Complete(), 0);
    }

    protected getHintTarget(): Node | null {
        return this._states.find(state => !state.fallen)?.node ?? null;
    }

    protected onToolDragStart(): void {
        // Đầu lượt kéo coi như đang ở ngoài: chạm vào web ngay là tính 1 lần lau.
        this._states.forEach(state => { state.inside = false; });
    }

    protected onToolDrag(): boolean {
        let acting = false;
        for (const state of this._states) {
            if (state.fallen) continue;
            if (!state.inside) {
                if (!this.isPointInside(this._point, state.node, this.hitPadding)) continue;
                state.inside = true;
                this.hit(state);
            } else if (!this.isPointInside(this._point, state.node, this.exitPadding)) {
                // Phải ra ngoài hẳn web thì lần vào sau mới tính thêm 1 lần lau.
                state.inside = false;
                continue;
            }
            acting = true;
        }
        return acting;
    }

    private hit(state: WebState): void {
        state.hits++;
        if (state.hits >= this.hitsToFall) {
            this.fall(state);
        } else {
            this.shake(state);
        }
    }

    private shake(state: WebState): void {
        const node = state.node;
        const step = this.shakeDuration / 4;
        Tween.stopAllByTarget(node);
        node.angle = state.restAngle;
        tween(node)
            .to(step, { angle: state.restAngle + this.shakeAngle }, { easing: 'sineOut' })
            .to(step * 2, { angle: state.restAngle - this.shakeAngle }, { easing: 'sineInOut' })
            .to(step, { angle: state.restAngle }, { easing: 'sineIn' })
            .start();
    }

    private fall(state: WebState): void {
        state.fallen = true;
        const node = state.node;
        Tween.stopAllByTarget(node);
        node.angle = state.restAngle;

        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        const target = new Vec3(state.restPosition.x, state.restPosition.y - this.fallDistance, state.restPosition.z);
        const spin = (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 20);
        tween(node)
            .to(this.fallDuration, { position: target, angle: state.restAngle + spin }, { easing: 'quadIn' })
            .call(() => { node.active = false; })
            .start();
        tween(opacity)
            .delay(this.fallDuration * 0.5)
            .to(this.fallDuration * 0.5, { opacity: 0 })
            .start();

        // Web cuối vừa bắt đầu rơi là xong bước luôn, không chờ rơi hết.
        if (this._states.every(s => s.fallen)) this.Complete();
    }
}
