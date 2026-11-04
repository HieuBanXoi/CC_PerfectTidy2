import { _decorator, Component, input, Input, Node, Vec3 } from 'cc';
import { HandHintPlayer } from './HandHintPlayer';
import { HandTutManager } from './HandTutManager';
import { GameManager } from './GameManager';

const { ccclass, property } = _decorator;

/** 1 gợi ý tay: kéo từ A tới B, hoặc nhấn vào 1 node. canContinue false -> tay tự tắt. */
export type HandHintRequest =
    | { kind: 'move'; getStart: () => Vec3; getEnd: () => Vec3; canContinue: () => boolean }
    | { kind: 'tap'; target: Node; canContinue: () => boolean };

/** Hệ thống có thể đưa ra gợi ý tay (ItemSpawnManager, CabinetDoor, StudyBox...). Trả null nếu hiện không có gì để gợi ý. */
export interface HandHintSource {
    GetHandHint(): HandHintRequest | null;
}

interface RegisteredSource {
    source: HandHintSource;
    priority: number;
}

/**
 * Tay gợi ý khi người chơi không tương tác idleDelay giây.
 * - Chạm màn hình: ẩn tay, đếm lại từ đầu. Đang giữ / kéo thì không đếm.
 * - Tay đầu tiên hiện sau firstHintDelay (mặc định ngay khi có gợi ý), các lần sau hết idleDelay mới hiện.
 * - Hết thời gian chờ: hỏi lần lượt các HandHintSource đã đăng ký (priority nhỏ hỏi trước), source đầu tiên
 *   có gợi ý sẽ được hiện; tay lặp lại tới khi người chơi chạm hoặc gợi ý hết hợp lệ.
 * - Gợi ý hết hợp lệ (ví dụ item vừa bị che) -> chọn gợi ý khác ngay.
 *
 * Độc lập: các source tự đăng ký qua IdleHandHint.Register, không cần biết component này có trong scene hay không.
 * Đặt trên node luôn active (ví dụ Manager).
 */
@ccclass('IdleHandHint')
export class IdleHandHint extends Component {
    public static Ins: IdleHandHint | null = null;

    private static readonly _sources: RegisteredSource[] = [];
    private static readonly RETRY_INTERVAL = 0.2;

    /** Đăng ký nguồn gợi ý. priority nhỏ = ưu tiên cao. */
    public static Register(source: HandHintSource, priority: number): void {
        if (IdleHandHint._sources.some(s => s.source === source)) return;
        IdleHandHint._sources.push({ source, priority });
        IdleHandHint._sources.sort((a, b) => a.priority - b.priority);
    }

    public static Unregister(source: HandHintSource): void {
        const index = IdleHandHint._sources.findIndex(s => s.source === source);
        if (index >= 0) IdleHandHint._sources.splice(index, 1);
    }

    @property({ type: Node, tooltip: 'Node tay. Để trống: HandTutManager.Ins.handNode.' })
    public handNode: Node | null = null;

    @property({ min: 0, tooltip: 'Không tương tác bao lâu (giây) thì hiện tay gợi ý.' })
    public idleDelay = 5;

    @property({ min: 0, tooltip: 'Tay gợi ý đầu tiên: hiện sau bao lâu (giây) kể từ khi có gợi ý (0 = ngay). Người chơi đã chạm trước đó hoặc các lần sau: dùng idleDelay.' })
    public firstHintDelay = 0;

    @property({ min: 0.01, tooltip: 'Gợi ý kéo: thời gian tay đi từ item tới chỗ đặt (giây).' })
    public moveDuration = 1.2;

    @property({ min: 0, tooltip: 'Gợi ý kéo: thời gian tay mờ dần ở đích (giây).' })
    public fadeOutDuration = 0.3;

    @property({ min: 0, tooltip: 'Gợi ý kéo: nghỉ ở đích trước khi lặp lại (giây).' })
    public waitAtEndDuration = 0.2;

    @property({ min: 0.1, tooltip: 'Gợi ý nhấn: tỉ lệ scale tay khi nhấn.' })
    public tapPressScale = 0.8;

    @property({ min: 0.01, tooltip: 'Gợi ý nhấn: thời gian 1 nhịp nhấn xuống / nhả lên (giây).' })
    public tapPressDuration = 0.3;

    @property({ min: 0, tooltip: 'Gợi ý nhấn: nghỉ giữa 2 lần nhấn (giây).' })
    public tapWaitDuration = 0.3;

    private _idleTime = 0;
    private _pointerDown = false;
    private _showing = false;
    private _hasShownOnce = false;
    private _retryTimer = 0;
    private _showOnRelease = false; // ShowNow lúc đang giữ tay -> nhả tay ra là hiện luôn (không đợi idleDelay)     // Không có gợi ý nào: đợi chút rồi hỏi lại (không hỏi mỗi frame)

    // ==================== LIFECYCLE ====================

    protected onLoad(): void {
        IdleHandHint.Ins = this;
    }

    protected onEnable(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    protected onDisable(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        this.Hide();
    }

    protected onDestroy(): void {
        if (IdleHandHint.Ins === this) IdleHandHint.Ins = null;
    }

    protected update(dt: number): void {
        if (GameManager.Ins && !GameManager.Ins.IsPlaying()) {
            this.Hide();
            this._idleTime = 0;
            return;
        }

        // Gợi ý đang hiện mà hết hợp lệ / bị hệ thống khác tắt -> chọn gợi ý khác ngay.
        if (this._showing && !this.Player?.IsPlaying(this)) {
            this._showing = false;
            if (!this._pointerDown) {
                this._idleTime = this.CurrentDelay;
                this._retryTimer = 0;
            }
        }
        if (this._showing || this._pointerDown) return;

        this._idleTime += dt;
        if (this._idleTime < this.CurrentDelay) return;
        this._retryTimer -= dt;
        if (this._retryTimer <= 0) this.tryShow();
    }

    // ==================== API ====================

    /** Hiện gợi ý ngay (không đợi idleDelay). Đang giữ tay thì nhả ra mới hiện. */
    public ShowNow(): void {
        if (this._pointerDown) {
            this._showOnRelease = true;
            return;
        }
        this.Hide();
        this._idleTime = this.CurrentDelay;
        this.tryShow();
        // ShowNow gọi lúc chưa có gợi ý (ví dụ item vừa đáp) -> frame sau hỏi lại luôn.
        this._retryTimer = 0;
    }

    /** Bắt đầu đếm lại từ đầu (ví dụ vừa có item mới xuất hiện): tay hiện sau idleDelay nếu người chơi không tương tác. */
    public RestartCountdown(): void {
        this._showOnRelease = false;
        this.Hide();
    }

    /** Ẩn tay và đếm lại thời gian không tương tác. */
    public Hide(): void {
        this._showing = false;
        this._idleTime = 0;
        this._retryTimer = 0;
        this.Player?.Stop(this);
    }

    // ==================== INTERNAL ====================

    private onTouchStart(): void {
        this._pointerDown = true;
        // Người chơi đã tự tương tác: hết ưu đãi "tay đầu tiên hiện ngay", từ giờ đợi idleDelay.
        this._hasShownOnce = true;
        this.Hide();
    }

    private onTouchEnd(): void {
        this._pointerDown = false;
        this._idleTime = this._showOnRelease ? this.CurrentDelay : 0;
        this._retryTimer = 0;
        this._showOnRelease = false;
    }

    /** Hỏi các source theo thứ tự ưu tiên; không ai có gợi ý thì RETRY_INTERVAL giây sau hỏi lại. */
    private tryShow(): void {
        const player = this.Player;
        this._retryTimer = IdleHandHint.RETRY_INTERVAL;
        if (!player) return;

        for (const { source } of IdleHandHint._sources) {
            const hint = source.GetHandHint();
            if (!hint) continue;

            // Đồng bộ với HandTutManager: tắt gợi ý của nó (nếu đang hiện) trước khi dùng tay.
            HandTutManager.Ins?.ResetHandTutDelay();
            if (hint.kind === 'move') {
                player.PlayMove(this, hint.getStart, hint.getEnd, {
                    moveDuration: this.moveDuration,
                    fadeOutDuration: this.fadeOutDuration,
                    waitAtEndDuration: this.waitAtEndDuration,
                }, hint.canContinue);
            } else {
                player.PlayTap(this, hint.target, {
                    pressScale: this.tapPressScale,
                    pressDuration: this.tapPressDuration,
                    waitDuration: this.tapWaitDuration,
                }, hint.canContinue);
            }
            this._showing = player.IsPlaying(this);
            if (this._showing) this._hasShownOnce = true;
            return;
        }
    }

    /** Thời gian chờ hiện tại: chưa hiện tay lần nào và người chơi chưa chạm -> firstHintDelay, sau đó -> idleDelay. */
    private get CurrentDelay(): number {
        return this._hasShownOnce ? this.idleDelay : this.firstHintDelay;
    }

    private get Player(): HandHintPlayer | null {
        return HandHintPlayer.For(this.handNode ?? HandTutManager.Ins?.handNode);
    }
}
