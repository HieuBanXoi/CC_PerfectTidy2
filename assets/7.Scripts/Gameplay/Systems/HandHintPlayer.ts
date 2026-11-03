import { Node, Tween, tween, UIOpacity, Vec3 } from 'cc';

export interface HandMoveHintOptions {
    /** Thời gian tay đi từ điểm đầu tới điểm cuối (giây). */
    moveDuration: number;
    /** Thời gian tay mờ dần khi tới đích (giây). 0 = tắt ngay. */
    fadeOutDuration: number;
    /** Nghỉ ở đích trước khi lặp lại (giây). */
    waitAtEndDuration: number;
}

export interface HandTapHintOptions {
    /** Tỉ lệ scale khi nhấn (so với scale gốc của tay). */
    pressScale: number;
    /** Thời gian 1 nhịp nhấn xuống / nhả lên (giây). */
    pressDuration: number;
    /** Nghỉ giữa 2 lần nhấn (giây). */
    waitDuration: number;
}

/**
 * Điều khiển 1 node tay gợi ý (dùng chung giữa các hệ thống: ItemSpawnManager, StudyBox...).
 * - Mỗi node tay có đúng 1 player (HandHintPlayer.For(node)) nên các hệ thống không giành nhau:
 *   hint mới luôn thay hint cũ, Stop(owner) chỉ tắt hint do chính owner bật.
 * - Vị trí đầu/cuối đọc lại mỗi vòng lặp nên tay bám theo item đang nhấp nhô.
 * - canContinue trả false thì hint tự tắt.
 */
export class HandHintPlayer {
    private static readonly _players = new Map<Node, HandHintPlayer>();

    public static For(hand: Node | null | undefined): HandHintPlayer | null {
        if (!hand || !hand.isValid) return null;
        // Node tay của scene cũ đã bị huỷ (reload scene): bỏ player cũ.
        for (const key of HandHintPlayer._players.keys()) {
            if (!key.isValid) HandHintPlayer._players.delete(key);
        }
        let player = HandHintPlayer._players.get(hand);
        if (!player) {
            player = new HandHintPlayer(hand);
            HandHintPlayer._players.set(hand, player);
        }
        return player;
    }

    private readonly _hand: Node;
    private readonly _baseScale: Vec3;
    private readonly _baseAlpha: number;
    private _token = 0;
    private _owner: object | null = null;

    private constructor(hand: Node) {
        this._hand = hand;
        this._baseScale = hand.scale.clone();
        this._baseAlpha = hand.getComponent(UIOpacity)?.opacity ?? 255;
    }

    public get Hand(): Node {
        return this._hand;
    }

    /** owner đang có hint hiển thị (chưa bị hint khác thay hay bị ẩn bởi hệ thống khác). */
    public IsPlaying(owner: object): boolean {
        return this._owner === owner && this._hand.isValid && this._hand.active;
    }

    /** Tay kéo từ getStart() tới getEnd(), mờ dần ở đích rồi lặp lại. */
    public PlayMove(
        owner: object,
        getStart: () => Vec3,
        getEnd: () => Vec3,
        options: HandMoveHintOptions,
        canContinue: () => boolean = () => true,
    ): void {
        const token = this.begin(owner, getStart());
        const loop = () => {
            if (!this.isCurrent(token)) return;
            if (!canContinue()) {
                this.Stop(owner);
                return;
            }
            this.bringToFront();
            this._hand.setWorldPosition(getStart());
            this.setAlpha(this._baseAlpha);
            tween(this._hand)
                .to(options.moveDuration, { worldPosition: getEnd().clone() }, { easing: 'sineInOut' })
                .call(() => this.fadeThen(token, options, loop))
                .start();
        };
        loop();
    }

    /** Tay đứng tại target, nhấn nhấn lặp lại. */
    public PlayTap(owner: object, target: Node, options: HandTapHintOptions, canContinue: () => boolean = () => true): void {
        const token = this.begin(owner, target.worldPosition);
        const base = this._baseScale;
        const pressed = new Vec3(base.x * options.pressScale, base.y * options.pressScale, base.z);
        const loop = () => {
            if (!this.isCurrent(token)) return;
            if (!canContinue() || !target.isValid || !target.activeInHierarchy) {
                this.Stop(owner);
                return;
            }
            this.bringToFront();
            this._hand.setWorldPosition(target.worldPosition);
            tween(this._hand)
                .to(options.pressDuration, { scale: pressed }, { easing: 'sineOut' })
                .to(options.pressDuration, { scale: base }, { easing: 'sineIn' })
                .delay(options.waitDuration)
                .call(loop)
                .start();
        };
        loop();
    }

    /** Tắt hint. Truyền owner: chỉ tắt nếu hint hiện tại là của owner đó. */
    public Stop(owner?: object): void {
        if (owner && this._owner !== owner) return;
        this._token++;
        this._owner = null;
        if (!this._hand.isValid) return;
        Tween.stopAllByTarget(this._hand);
        const opacity = this._hand.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
        this._hand.setScale(this._baseScale);
        this.setAlpha(this._baseAlpha);
        this._hand.active = false;
    }

    private begin(owner: object, position: Vec3): number {
        this.Stop();
        this._owner = owner;
        this._hand.setWorldPosition(position);
        this._hand.setScale(this._baseScale);
        this.setAlpha(this._baseAlpha);
        this._hand.active = true;
        return this._token;
    }

    private isCurrent(token: number): boolean {
        return token === this._token && this._hand.isValid && this._hand.activeInHierarchy;
    }

    private fadeThen(token: number, options: HandMoveHintOptions, next: () => void): void {
        if (!this.isCurrent(token)) return;
        const opacity = this._hand.getComponent(UIOpacity);
        if (!opacity || options.fadeOutDuration <= 0) {
            this.setAlpha(0);
            tween(this._hand).delay(options.waitAtEndDuration).call(next).start();
            return;
        }
        tween(opacity)
            .to(options.fadeOutDuration, { opacity: 0 }, { easing: 'sineIn' })
            .delay(options.waitAtEndDuration)
            .call(next)
            .start();
    }

    private setAlpha(alpha: number): void {
        const opacity = this._hand.getComponent(UIOpacity);
        if (opacity) opacity.opacity = alpha;
    }

    private bringToFront(): void {
        const parent = this._hand.parent;
        if (parent) this._hand.setSiblingIndex(parent.children.length - 1);
    }
}
