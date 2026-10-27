import { _decorator, Component, Enum, EventTouch, Input, input, Node, Tween, tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import { Ply_Event } from '../Framework/Ply_Event';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { InputManager } from '../../Core/Managers/InputManager';

const { ccclass, property } = _decorator;

/**
 * Popup hướng dẫn (Turorial):
 * - Show: popup bật lên giữa màn hình, icon-hint hiện cùng lúc và giữ luôn. Trong lúc mở, gameplay bị khoá input.
 * - Chạm ra ngoài vùng popup: popup nhảy lên rồi thu nhỏ bay vào icon-hint, icon-hint nảy lên.
 * - Chạm icon-hint: popup nhảy từ icon ra lại giữa màn hình.
 * Gắn component lên node luôn active (ví dụ Binding).
 */
@ccclass('TutorialPopup')
export class TutorialPopup extends Component {
    @property({ type: Node, tooltip: 'Popup giữa màn hình (Turorial). Ẩn lúc đầu. Vùng chạm lấy theo UITransform của node này.' })
    public popup: Node | null = null;

    @property({ type: Node, tooltip: 'Icon gợi ý ở góc (icon-hint). Ẩn lúc đầu, hiện cùng lúc với popup; chạm vào để mở lại popup.' })
    public hintIcon: Node | null = null;

    @property({ type: Node, tooltip: 'Nền tối phía sau popup (tuỳ chọn). Bật/tắt cùng popup.' })
    public dim: Node | null = null;

    @property({ tooltip: 'Khoá input gameplay (InputManager) khi popup đang mở giữa màn hình.' })
    public lockGameplayInput = true;

    @property({ min: 0.01, tooltip: 'Thời gian popup bật lên (giây).' })
    public showDuration = 0.35;

    @property({ min: 0.01, tooltip: 'Thời gian popup nhảy vào icon / từ icon ra (giây).' })
    public jumpDuration = 0.45;

    @property({ tooltip: 'Độ cao cung nhảy khi popup bay vào / ra icon (world).' })
    public jumpHeight = 250;

    @property({ type: Enum(FxType), tooltip: 'Sound khi popup thu vào / mở ra.' })
    public clickFxType: FxType = FxType.Click;

    @property({ type: Ply_Event, tooltip: 'Gọi khi popup hiện xong giữa màn hình.' })
    public onOpened: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi popup đã thu vào icon.' })
    public onMinimized: Ply_Event = new Ply_Event();

    private _isOpen = false;
    private _isMoving = false;
    private _hasShown = false;
    private readonly _popupPos = new Vec3();
    private readonly _popupScale = new Vec3(1, 1, 1);
    private readonly _iconScale = new Vec3(1, 1, 1);
    private readonly _touchPos = new Vec2();

    /** Popup đang mở (hoặc đang chạy hiệu ứng) giữa màn hình. */
    public get IsOpen(): boolean {
        return this._isOpen || this._isMoving;
    }

    public get HasShown(): boolean {
        return this._hasShown;
    }

    public resetInEditor(): void {
        if (!this.onOpened) this.onOpened = new Ply_Event();
        if (!this.onMinimized) this.onMinimized = new Ply_Event();
    }

    protected onLoad(): void {
        if (this.popup) {
            this._popupPos.set(this.popup.position);
            this._popupScale.set(this.popup.scale);
            this.popup.active = false;
        }
        if (this.hintIcon) {
            this._iconScale.set(this.hintIcon.scale);
            this.hintIcon.active = false;
        }
        if (this.dim) this.dim.active = false;
    }

    protected onEnable(): void {
        input.on(Input.EventType.TOUCH_END, this.onScreenTouchEnd, this);
        this.hintIcon?.on(Node.EventType.TOUCH_END, this.onIconClick, this);
    }

    protected onDisable(): void {
        input.off(Input.EventType.TOUCH_END, this.onScreenTouchEnd, this);
        this.hintIcon?.off(Node.EventType.TOUCH_END, this.onIconClick, this);
        if (this._isOpen || this._isMoving) this.setGameplayLocked(false);
    }

    /** Bật popup giữa màn hình (lần đầu). */
    public Show(): void {
        const popup = this.popup;
        if (!popup || this._isOpen || this._isMoving) return;
        this._hasShown = true;
        this._isMoving = true;
        this.setGameplayLocked(true);
        this.popIcon();
        this.setDim(true);

        Tween.stopAllByTarget(popup);
        popup.active = true;
        popup.setPosition(this._popupPos);
        popup.setScale(Vec3.ZERO);
        tween(popup)
            .to(this.showDuration, { scale: this._popupScale }, { easing: 'backOut' })
            .call(() => this.finishOpen())
            .start();
    }

    /** Popup nhảy lên rồi thu nhỏ bay vào icon-hint. */
    public Minimize(): void {
        const popup = this.popup;
        if (!popup || !this._isOpen || this._isMoving) return;
        this._isOpen = false;
        this._isMoving = true;
        this.setDim(false);

        const finish = () => {
            popup.active = false;
            popup.setPosition(this._popupPos);
            popup.setScale(this._popupScale);
            this._isMoving = false;
            this.setGameplayLocked(false);
            this.popIcon();
            this.onMinimized.invoke();
        };
        if (!this.hintIcon) {
            tween(popup).to(0.2, { scale: Vec3.ZERO }, { easing: 'backIn' }).call(finish).start();
            return;
        }

        const from = popup.worldPosition.clone();
        const to = this.hintIcon.worldPosition.clone();
        this.jump(popup, from, to, this._popupScale, this.getPopupScaleMatchingIcon(), 'quadIn', finish);
    }

    /** Popup nhảy từ icon-hint ra lại giữa màn hình. */
    public Restore(): void {
        const popup = this.popup;
        if (!popup || this._isOpen || this._isMoving) return;
        this._isMoving = true;
        this.setGameplayLocked(true);
        const from = (this.hintIcon ?? popup).worldPosition.clone();
        this.setDim(true);

        Tween.stopAllByTarget(popup);
        popup.active = true;
        popup.setPosition(this._popupPos);
        const to = popup.worldPosition.clone();
        this.jump(popup, from, to, this.getPopupScaleMatchingIcon(), this._popupScale, 'quadOut', () => this.finishOpen());
    }

    private onScreenTouchEnd(event: EventTouch): void {
        if (!this._isOpen || this._isMoving || !this.popup) return;
        const transform = this.popup.getComponent(UITransform);
        event.getUILocation(this._touchPos);
        // Chạm trong vùng popup thì giữ nguyên.
        if (transform?.getBoundingBoxToWorld().contains(this._touchPos)) return;
        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        this.Minimize();
    }

    /** Chạm icon-hint: popup đang mở thì thu vào (như chạm ra ngoài), đang thu thì mở ra. */
    private onIconClick(): void {
        if (this._isMoving) return;
        Ply_SoundManager.Ins?.PlayFx(this.clickFxType);
        if (this._isOpen) this.Minimize();
        else this.Restore();
    }

    /** Bay theo cung parabol từ from tới to (world), đồng thời đổi scale. */
    private jump(node: Node, from: Vec3, to: Vec3, fromScale: Vec3, toScale: Vec3, easing: 'quadIn' | 'quadOut', onComplete: () => void): void {
        const state = { t: 0 };
        const pos = new Vec3();
        const scale = new Vec3();
        Tween.stopAllByTarget(node);
        node.setWorldPosition(from);
        node.setScale(fromScale);
        tween(state)
            .to(this.jumpDuration, { t: 1 }, {
                easing,
                onUpdate: () => {
                    if (!node.isValid) return;
                    const t = state.t;
                    Vec3.lerp(pos, from, to, t);
                    pos.y += this.jumpHeight * 4 * t * (1 - t);
                    node.setWorldPosition(pos);
                    node.setScale(Vec3.lerp(scale, fromScale, toScale, t));
                },
            })
            .call(onComplete)
            .start();
    }

    private finishOpen(): void {
        this._isMoving = false;
        this._isOpen = true;
        this.onOpened.invoke();
    }

    private popIcon(): void {
        const icon = this.hintIcon;
        if (!icon) return;
        Tween.stopAllByTarget(icon);
        icon.active = true;
        const s = this._iconScale;
        icon.setScale(s.x * 0.6, s.y * 0.6, s.z);
        tween(icon)
            .to(0.18, { scale: new Vec3(s.x * 1.15, s.y * 1.15, s.z) }, { easing: 'sineOut' })
            .to(0.12, { scale: s }, { easing: 'sineIn' })
            .start();
    }

    /** Local scale của popup sao cho kích thước trên màn hình vừa khít icon-hint. */
    private getPopupScaleMatchingIcon(): Vec3 {
        const popup = this.popup!;
        const icon = this.hintIcon;
        const popupUT = popup.getComponent(UITransform);
        const iconUT = icon?.getComponent(UITransform);
        if (!icon || !popupUT || !iconUT || popupUT.width <= 0 || popupUT.height <= 0) return Vec3.ZERO.clone();
        const parentScale = Math.abs(popup.parent?.worldScale.x ?? 1) || 1;
        const iconParentScale = Math.abs(icon.parent?.worldScale.x ?? 1);
        const iconW = iconUT.width * Math.abs(this._iconScale.x) * iconParentScale;
        const iconH = iconUT.height * Math.abs(this._iconScale.y) * iconParentScale;
        const k = Math.min(iconW / popupUT.width, iconH / popupUT.height) / parentScale;
        return new Vec3(k, k, 1);
    }

    private setGameplayLocked(locked: boolean): void {
        if (!this.lockGameplayInput) return;
        (InputManager.Ins as InputManager | null)?.SetInputLocked(locked);
    }

    private setDim(active: boolean): void {
        const dim = this.dim;
        if (!dim) return;
        const opacity = dim.getComponent(UIOpacity) ?? dim.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        if (active) {
            dim.active = true;
            opacity.opacity = 0;
            tween(opacity).to(0.2, { opacity: 255 }).start();
        } else {
            tween(opacity).to(0.2, { opacity: 0 }).call(() => { dim.active = false; }).start();
        }
    }
}
