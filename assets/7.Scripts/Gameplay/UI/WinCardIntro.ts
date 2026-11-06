import { _decorator, Animation, Color, Component, Node, Sprite, Tween, tween, UIOpacity, UITransform, Vec3, v3 } from 'cc';
import { BindUIType } from '../../Core/Managers/UI';
import { World } from '../../Core/Managers/World';
const { ccclass, property } = _decorator;

/**
 * WIN CARD INTRO
 * -------------------------------------------------------------
 * Đặt trên node endcard (VD End/Win). Mỗi lần node bật lên:
 *  1. Nền tối fade vào mượt.
 *  2. Logo rơi xuống + phóng to nảy (backOut), hơi lắc rồi thẳng lại.
 *  3. Nút PLAY NOW bật lên sau logo.
 *  4. Logo thở nhẹ + bồng bềnh lặp lại.
 * Thay cho Animation clip cũ (tự tắt Animation trên node này nếu có).
 */
@ccclass('WinCardIntro')
export class WinCardIntro extends Component {

    @property({ type: Sprite, tooltip: 'Nền tối phủ màn hình' })
    public dim: Sprite | null = null;

    @property({ tooltip: 'Alpha cuối của nền tối', range: [0, 255, 1] })
    public dimAlpha = 226;

    @property({ type: Node, tooltip: 'Panel chứa logo + nút (đặt luôn ở vị trí cuối)' })
    public panel: Node | null = null;

    @property({ type: Vec3, tooltip: 'Vị trí cuối của panel' })
    public panelPos: Vec3 = v3(0, -201, 0);

    @property({ type: Node, tooltip: 'Vị trí + kích thước logo trên endcard (điểm đích). Ẩn đi khi có logo UI bay tới.' })
    public logo: Node | null = null;

    @property({ type: [Node], tooltip: 'Logo trong UI gameplay (dọc + ngang). Logo nào đang hiện sẽ bay lên endcard.' })
    public uiLogos: Node[] = [];

    @property({ tooltip: 'Logo UI bay vòng lên cao hơn đích bao nhiêu (px)' })
    public flyArc = 220;

    @property({ type: Node, tooltip: 'Node nút để bật lên (con của node có Animation pulse)' })
    public button: Node | null = null;

    @property({ tooltip: 'Neo logo sát mép TRÊN màn hình, cách mép bao nhiêu (px world). -1 = giữ vị trí node Logo.' })
    public logoTopMargin = -1;

    @property({ tooltip: 'Neo nút PLAY NOW sát mép DƯỚI màn hình, cách mép bao nhiêu (px world). -1 = giữ vị trí cũ.' })
    public buttonBottomMargin = -1;

    @property({ type: Node, tooltip: 'Khung giữa màn hình chứa level mới (con: Wood, Content, Border). Tự co giãn vừa khoảng giữa logo và nút.' })
    public levelFrame: Node | null = null;

    @property({ tooltip: 'Khoảng cách khung với logo / nút (px)', visible(this: WinCardIntro) { return !!this.levelFrame; } })
    public frameGap = 30;

    @property({ tooltip: 'Chiều rộng tối đa của khung (px)', visible(this: WinCardIntro) { return !!this.levelFrame; } })
    public frameMaxWidth = 960;

    @property({ tooltip: 'Viền khung dày bao nhiêu (nền gỗ thụt vào, px)', visible(this: WinCardIntro) { return !!this.levelFrame; } })
    public frameBorder = 22;

    @property({ tooltip: 'Lề trong: vùng Content (chứa map) thụt vào so với khung (px)', visible(this: WinCardIntro) { return !!this.levelFrame; } })
    public framePadding = 40;

    @property({ tooltip: 'Tỉ lệ rộng/cao của vùng map trong khung (= endcardMapSize.x / .y của GridPackManager)', visible(this: WinCardIntro) { return !!this.levelFrame; } })
    public frameAspect = 0.73;

    @property({ tooltip: 'Logo UI chỉ di chuyển thẳng tới chỗ đích (không bay vòng, không nảy, không thở)' })
    public logoPlainMove = true;

    @property public logoDelay = 0.15;
    @property public logoDropY = 260;
    @property public logoDuration = 0.7;
    @property public buttonDelay = 0.65;

    @property({ tooltip: 'Biên độ thở của logo' })
    public idleScale = 0.035;
    @property({ tooltip: 'Biên độ bồng bềnh (px)' })
    public idleBob = 10;
    @property public idlePeriod = 2.2;

    private _logoScale = v3(1, 1, 1);
    private _logoPos = v3();
    private _btnScale = v3(1, 1, 1);
    /** Logo đang hiển thị trên endcard (logo UI đã bay tới, hoặc node đích). */
    private _shown: Node | null = null;
    private _flown = false;
    private _captured = false;

    protected onLoad() {
        const anim = this.getComponent(Animation);
        if (anim) { anim.playOnLoad = false; anim.stop(); }
        this.capture();
    }

    private capture() {
        if (this._captured) return;
        this._captured = true;
        if (this.logo) { this._logoScale.set(this.logo.scale); this._logoPos.set(this.logo.position); }
        if (this.button) this._btnScale.set(this.button.scale);
    }

    protected onEnable() {
        this.capture();
        this.getComponent(Animation)?.stop();
        this.play();
    }

    protected onDisable() {
        this.stopAll();
    }

    private opacityOf(n: Node) {
        return n.getComponent(UIOpacity) || n.addComponent(UIOpacity);
    }

    private stopAll() {
        if (this.dim) Tween.stopAllByTarget(this.dim);
        if (this.levelFrame) { Tween.stopAllByTarget(this.levelFrame); Tween.stopAllByTarget(this.opacityOf(this.levelFrame)); }
        for (const n of [this.logo, this._shown]) {
            if (n && n.isValid) { Tween.stopAllByTarget(n); Tween.stopAllByTarget(this.opacityOf(n)); }
        }
        if (this.button) Tween.stopAllByTarget(this.button);
        if (this._flyTween) { Tween.stopAllByTarget(this._flyTween); this._flyTween = null; }
        if (this._idleTarget) { Tween.stopAllByTarget(this._idleTarget); this._idleTarget = null; }
    }

    public play() {
        this.stopAll();

        // 1. Nền tối
        if (this.dim) {
            const c = this.dim.color.clone();
            const from = { a: 0 };
            this.dim.color = new Color(c.r, c.g, c.b, 0);
            tween(from).to(0.4, { a: this.dimAlpha }, {
                easing: 'sineOut',
                onUpdate: () => { if (this.dim) this.dim.color = new Color(c.r, c.g, c.b, Math.round(from.a)); },
            }).start();
        }

        // Panel đứng yên ở vị trí cuối, hiện rõ (clip cũ trượt + fade panel)
        if (this.panel) {
            this.panel.setPosition(this.panelPos);
            const sp = this.panel.getComponent(Sprite);
            if (sp) { const c = sp.color.clone(); c.a = 255; sp.color = c; }
        }
        this.anchorToEdges();
        this.showFrame();

        // 2. Logo: logo UI đang hiện (dọc hoặc ngang) bay lên endcard; không có thì logo đích rơi xuống
        if (!this._flown && this.flyUILogo()) {
            // flyUILogo đã chạy tween
        } else if (this._shown || this.logo) {
            const logo = (this._shown || this.logo)!;
            this._shown = logo;
            const s = this._logoScale, p = this._logoPos;
            const op = this.opacityOf(logo);
            op.opacity = 0;
            logo.setScale(s.x * 0.35, s.y * 0.35, s.z);
            logo.setPosition(p.x, p.y + this.logoDropY, p.z);
            logo.angle = -8;
            const d = this.logoDuration;
            tween(op).delay(this.logoDelay).to(d * 0.35, { opacity: 255 }, { easing: 'sineOut' }).start();
            tween(logo).delay(this.logoDelay)
                .parallel(
                    tween(logo).to(d, { position: p }, { easing: 'backOut' }),
                    tween(logo).to(d * 0.6, { scale: v3(s.x * 1.12, s.y * 0.94, s.z) }, { easing: 'sineOut' })
                        .to(d * 0.4, { scale: s }, { easing: 'backOut' }),
                    tween(logo).to(d * 0.5, { angle: 4 }, { easing: 'sineOut' })
                        .to(d * 0.5, { angle: 0 }, { easing: 'sineInOut' }),
                )
                .call(() => this.startIdle())
                .start();
        }

        // 3. Nút
        const btn = this.button;
        if (btn) {
            const bs = this._btnScale;
            btn.setScale(0, 0, bs.z);
            tween(btn).delay(this.buttonDelay)
                .to(0.45, { scale: bs }, { easing: 'backOut' })
                .start();
        }
    }

    /** Neo logo vào mép trên, nút vào mép dưới màn hình (theo UI.getEdge) -> không che gameplay ở giữa. */
    private anchorToEdges() {
        const panel = this.panel;
        const ui = World.instance?.ui;
        if (!panel || !ui) return;
        const toLocal = (parent: Node, worldY: number) => {
            const out = v3();
            parent.inverseTransformPoint(out, v3(parent.worldPosition.x, worldY, 0));
            return out.y;
        };
        if (this.logoTopMargin >= 0 && this.logo) {
            const top = ui.getEdge(BindUIType.Top);
            const h = (this.logo.getComponent(UITransform)?.height || 0) * Math.abs(this._logoScale.y * panel.worldScale.y);
            this._logoPos.y = toLocal(panel, top - this.logoTopMargin - h * 0.5);
            this.logo.setPosition(this._logoPos);
        }
        const wrap = this.button?.parent;
        if (this.buttonBottomMargin >= 0 && this.button && wrap && wrap.parent) {
            const bottom = ui.getEdge(BindUIType.Bottom);
            const h = (this.button.getComponent(UITransform)?.height || 0) * Math.abs(this._btnScale.y * wrap.worldScale.y);
            const p = wrap.position;
            wrap.setPosition(p.x, toLocal(wrap.parent, bottom + this.buttonBottomMargin + h * 0.5), p.z);
        }
    }

    /** Khung level mới: co giãn vừa khoảng giữa logo và nút (sau anchorToEdges), rồi bật lên. */
    private showFrame() {
        const fr = this.levelFrame, panel = this.panel;
        if (!fr || !panel) return;
        const ui = World.instance?.ui;
        // Khoảng dọc giữa đáy logo và đỉnh nút (local của panel)
        let top = 600, bottom = -600;
        if (this.logo) {
            const lh = (this.logo.getComponent(UITransform)?.height || 0) * Math.abs(this._logoScale.y);
            top = this._logoPos.y - lh * 0.5 - this.frameGap;
        }
        const wrap = this.button?.parent;
        if (this.button && wrap) {
            const bh = (this.button.getComponent(UITransform)?.height || 0) * Math.abs(this._btnScale.y * wrap.scale.y);
            bottom = wrap.position.y + bh * 0.5 + this.frameGap;
        }
        // Khung ôm vừa map theo tỉ lệ frameAspect (không thừa trên dưới), không vượt khoảng giữa logo - nút
        const maxH = Math.max(200, top - bottom);
        const fullW = ui ? (ui.width * 2) / Math.abs(panel.worldScale.x || 1) : 1080;
        const pad = this.framePadding;
        const aspect = Math.max(0.1, this.frameAspect);
        let w = Math.min(this.frameMaxWidth, fullW - 60);
        let h = (w - pad * 2) / aspect + pad * 2;
        if (h > maxH) { h = maxH; w = (h - pad * 2) * aspect + pad * 2; }
        fr.setPosition(0, (top + bottom) * 0.5, 0);
        // Khung thấp hơn khoảng trống -> kéo logo xuống, nút lên cho sát khung (cách frameGap)
        const slack = (maxH - h) * 0.5;
        if (slack > 0) {
            if (this.logo) { this._logoPos.y -= slack; this.logo.setPosition(this._logoPos); }
            if (wrap && this.button) { const p = wrap.position; wrap.setPosition(p.x, p.y + slack, p.z); }
        }
        fr.getComponent(UITransform)?.setContentSize(w, h);
        const size = (name: string, inset: number) => fr.getChildByName(name)?.getComponent(UITransform)?.setContentSize(Math.max(10, w - inset * 2), Math.max(10, h - inset * 2));
        size('Border', 0);
        size('Wood', this.frameBorder);
        size('Content', this.framePadding);

        fr.active = true;
        const op = this.opacityOf(fr);
        op.opacity = 0;
        fr.setScale(0.85, 0.85, 1);
        tween(op).delay(0.05).to(0.25, { opacity: 255 }).start();
        tween(fr).delay(0.05).to(0.4, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
    }

    /** Lấy logo UI đang hiện, chuyển vào panel (giữ nguyên vị trí màn hình) rồi bay vòng lên chỗ đích. */
    private flyUILogo(): boolean {
        const target = this.logo, panel = this.panel || target?.parent;
        if (!target || !panel) return false;
        const fly = this.uiLogos.find(n => n && n.isValid && n.activeInHierarchy);
        if (!fly) return false;
        this._flown = true;

        fly.setParent(panel, true);
        fly.setSiblingIndex(target.getSiblingIndex());
        // Logo UI có thể ở layer/camera khác (UI_2D) -> đổi theo endcard để vẽ trên nền tối
        const setLayer = (n: Node) => { n.layer = target.layer; n.children.forEach(setLayer); };
        setLayer(fly);
        target.active = false;
        this._shown = fly;
        this.opacityOf(fly).opacity = 255;

        // Scale đích: khớp chiều rộng node đích
        const tw = (target.getComponent(UITransform)?.width || 1) * this._logoScale.x;
        const fw = fly.getComponent(UITransform)?.width || 1;
        const k = tw / fw;
        const end = this._logoPos.clone();
        const endScale = v3(k, k, 1);
        this._logoScale.set(endScale);

        if (this.logoPlainMove) {
            // Chỉ di chuyển + đổi cỡ mượt tới chỗ đích
            tween(fly).delay(this.logoDelay)
                .to(this.logoDuration, { position: end, scale: endScale, angle: 0 }, { easing: 'sineInOut' })
                .start();
            return true;
        }

        const start = fly.position.clone();
        const startScale = fly.scale.clone();
        const startAngle = fly.angle;
        const ctrl = v3((start.x + end.x) * 0.5, Math.max(start.y, end.y) + this.flyArc, 0);
        const st = { t: 0 };
        const d = this.logoDuration + 0.15;
        const over = 1.12;
        tween(st).delay(this.logoDelay)
            .to(d, { t: 1 }, {
                easing: 'sineInOut',
                onUpdate: () => {
                    if (!fly.isValid) return;
                    const t = st.t, u = 1 - t;
                    fly.setPosition(
                        u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x,
                        u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y, 0);
                    // to dần, vượt nhẹ ở cuối đường bay
                    const sx = startScale.x + (endScale.x * over - startScale.x) * t;
                    const sy = startScale.y + (endScale.y * over - startScale.y) * t;
                    fly.setScale(sx, sy, 1);
                    fly.angle = startAngle * u + Math.sin(t * Math.PI) * 6;
                },
            })
            .call(() => {
                if (!fly.isValid) return;
                tween(fly)
                    .to(0.35, { scale: endScale, angle: 0 }, { easing: 'backOut' })
                    .call(() => this.startIdle())
                    .start();
            })
            .start();
        this._flyTween = st;
        return true;
    }

    private _flyTween: any = null;

    /** Logo thở + bồng bềnh lặp lại (lệch pha nhau cho tự nhiên). */
    private startIdle() {
        const logo = this._shown;
        if (!logo || !logo.isValid || this.logoPlainMove) return;
        const s = this._logoScale, p = this._logoPos;
        const t = { k: 0 };
        const T = this.idlePeriod;
        tween(t).repeatForever(
            tween(t).to(T, { k: 1 }, {
                onUpdate: () => {
                    if (!logo.isValid) return;
                    const a = t.k * Math.PI * 2;
                    const sc = 1 + Math.sin(a) * this.idleScale;
                    logo.setScale(s.x * sc, s.y * sc, s.z);
                    logo.setPosition(p.x, p.y + Math.sin(a + Math.PI / 2) * this.idleBob - this.idleBob, p.z);
                },
            }).set({ k: 0 })
        ).start();
        this._idleTarget = t;
    }

    private _idleTarget: any = null;

    protected onDestroy() {
        this.stopAll();
    }
}
