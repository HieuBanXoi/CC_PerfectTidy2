import { _decorator, Component, Node, Tween, tween, Vec3, Enum } from 'cc';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { InputManager } from '../../Core/Managers/InputManager';
import { HandTutManager } from '../Systems/HandTutManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';

const { ccclass, property } = _decorator;

/** Vị trí gốc của một node đi kèm (không có CleanToolSlide riêng). */
interface LinkedNodeState {
    shownPos: Vec3;
}

/**
 * Hiệu ứng ra/vào màn hình cho clean tool.
 * - SlideIn: node (thường để inactive trên scene) được bật lên và bay từ dưới lên về vị trí đặt trên scene.
 *   Các node trong appearTogether cũng bay lên cùng lúc.
 * - SlideOut: tool (và exitTogether) bay xuống dưới rồi tắt node.
 * ItemCleanManager tự gọi SlideIn khi tool tới lượt và SlideOut sau ItemCleanDone (nếu exitOnDone).
 */
@ccclass('CleanToolSlide')
export class CleanToolSlide extends Component {
    @property({ tooltip: 'Khoảng cách bay theo trục Y (bay từ dưới lên / bay xuống dưới).' })
    public slideDistance = 900;

    @property({ min: 0.01, tooltip: 'Thời gian bay lên (giây).' })
    public inDuration = 0.5;

    @property({ min: 0.01, tooltip: 'Thời gian bay xuống (giây).' })
    public outDuration = 0.4;

    @property({ min: 0, tooltip: 'Độ trễ trước khi bay lên (dùng để so le khi nhiều tool bay lên cùng lúc).' })
    public inDelay = 0;

    @property({ tooltip: 'Tự bay xuống và biến mất khi ItemCleanManager báo item này xong.' })
    public exitOnDone = true;

    @property({ type: [Node], tooltip: 'Các node bay lên cùng lúc với tool này (ví dụ shower kéo theo brush, towel, spray bottle).' })
    public appearTogether: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node bay xuống cùng lúc với tool này (ví dụ sand shovel kéo theo trash bag).' })
    public exitTogether: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node được dịch đi khi tool này bay lên (ví dụ dịch SandBox để cân màn hình). Chỉ dịch khi tool thực sự bay lên từ trạng thái ẩn.' })
    public shiftNodes: Node[] = [];

    @property({ tooltip: 'Độ dịch (local position) áp dụng cho shiftNodes.' })
    public shiftOffset: Vec3 = new Vec3();

    @property({ tooltip: 'Độ cao cung nhảy khi dịch shiftNodes (local). 0 = trượt thẳng.' })
    public shiftJumpHeight = 0;

    @property({ min: 0, max: 0.5, step: 0.01, tooltip: 'Độ nhún (squash & stretch) khi nhảy. 0 = không nhún.' })
    public shiftSquash = 0.08;

    @property({ min: 0.01, tooltip: 'Thời gian dịch shiftNodes (giây).' })
    public shiftDuration = 0.5;

    @property({ tooltip: 'Phát âm thanh khi tool bay lên.' })
    public playAppearSound = true;

    @property({ type: Enum(FxType) })
    public appearFxType: FxType = FxType.CleanItemAppear;

    @property({ type: Ply_Event, tooltip: 'Gọi khi bay lên xong.' })
    public onSlideInComplete: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi bay xuống xong (node đã tắt).' })
    public onSlideOutComplete: Ply_Event = new Ply_Event();

    private _shownPos: Vec3 | null = null;
    private _isMoving = false;
    private readonly _linkedStates = new Map<Node, LinkedNodeState>();

    public get IsMoving(): boolean {
        return this._isMoving;
    }

    public resetInEditor(): void {
        if (!this.onSlideInComplete) this.onSlideInComplete = new Ply_Event();
        if (!this.onSlideOutComplete) this.onSlideOutComplete = new Ply_Event();
    }

    /** Bay lên tool này và toàn bộ appearTogether. onComplete gọi khi tất cả đã tới nơi. */
    public SlideIn(onComplete?: () => void): void {
        // Tool đã hiển thị nghĩa là cả nhóm đã bay lên từ trước. Không gọi lại
        // appearTogether, tránh kéo các tool đã xong (đã bay xuống) hiện lại.
        if (this.node.activeInHierarchy) {
            onComplete?.();
            return;
        }

        const nodes = [this.node, ...this.appearTogether].filter(node => node?.isValid);
        let pending = nodes.length;
        const done = () => {
            if (--pending <= 0) onComplete?.();
        };

        this.shiftLinkedNodes();

        for (const node of nodes) {
            const slide = node === this.node ? this : node.getComponent(CleanToolSlide);
            if (slide) {
                slide.SlideInSelf(done);
            } else {
                this.slideLinkedIn(node, done);
            }
        }
    }

    /** Bay xuống tool này và toàn bộ exitTogether rồi tắt node. */
    public SlideOut(onComplete?: () => void): void {
        const nodes = [this.node, ...this.exitTogether].filter(node => node?.isValid);
        let pending = nodes.length;
        const done = () => {
            if (--pending <= 0) onComplete?.();
        };

        for (const node of nodes) {
            const slide = node === this.node ? this : node.getComponent(CleanToolSlide);
            if (slide) {
                slide.SlideOutSelf(done);
            } else {
                this.slideLinkedOut(node, done);
            }
        }
    }

    /** Chỉ bay lên node này (không kéo theo appearTogether). */
    public SlideInSelf(onComplete?: () => void): void {
        // Node đã hiển thị sẵn trên scene thì không cần bay lên.
        if (this.node.activeInHierarchy && !this._isMoving) {
            onComplete?.();
            return;
        }

        if (!this._shownPos) this._shownPos = this.node.position.clone();
        const shownPos = this._shownPos;
        const draggable = this.getComponent(ItemDraggable);

        this._isMoving = true;
        Tween.stopAllByTarget(this.node);
        // Bật node trước để ItemDraggable.onLoad cache đúng vị trí gốc.
        this.node.active = true;
        this.node.setPosition(shownPos.x, shownPos.y - this.slideDistance, shownPos.z);
        if (draggable) draggable.isDraggable = false;

        tween(this.node)
            .delay(this.inDelay)
            .call(() => {
                if (this.playAppearSound) Ply_SoundManager.Ins?.PlayFx(this.appearFxType);
            })
            .to(this.inDuration, { position: shownPos }, { easing: 'backOut' })
            .call(() => {
                this._isMoving = false;
                if (draggable) draggable.isDraggable = true;
                HandTutManager.Ins?.ResetHandTutDelay();
                this.onSlideInComplete.invoke();
                onComplete?.();
            })
            .start();
    }

    /** Chỉ bay xuống node này (không kéo theo exitTogether). */
    public SlideOutSelf(onComplete?: () => void): void {
        const draggable = this.getComponent(ItemDraggable);
        if (draggable) {
            this.forceReleaseDrag(draggable);
            draggable.isDraggable = false;
        }

        if (!this._shownPos) this._shownPos = this.node.position.clone();

        // Tween không chạy trên node inactive; node đã ẩn thì coi như bay xuống xong.
        if (!this.node.activeInHierarchy) {
            this.node.active = false;
            this.onSlideOutComplete.invoke();
            onComplete?.();
            return;
        }

        this._isMoving = true;
        Tween.stopAllByTarget(this.node);

        const from = this.node.position;
        tween(this.node)
            .to(this.outDuration, { position: new Vec3(from.x, from.y - this.slideDistance, from.z) }, { easing: 'backIn' })
            .call(() => {
                this._isMoving = false;
                this.node.active = false;
                // Lần SlideIn sau (nếu có) sẽ bay về vị trí gốc trên scene.
                this.node.setPosition(this._shownPos!);
                if (draggable) draggable.isDraggable = true;
                this.onSlideOutComplete.invoke();
                onComplete?.();
            })
            .start();
    }

    /**
     * Tool có thể xong việc khi người chơi vẫn đang giữ tay. Kết thúc drag
     * ngay tại chỗ (không BreakHeart, không quay về) để tween bay xuống không
     * bị ItemDraggable ghi đè.
     */
    private forceReleaseDrag(draggable: ItemDraggable): void {
        if (!draggable.IsDragging) return;

        const returnOnFail = draggable.returnToStartOnDragFailed;
        const breakHeartOnFail = draggable.spawnBreakHeartOnDropFail;
        draggable.returnToStartOnDragFailed = false;
        draggable.spawnBreakHeartOnDropFail = false;

        const input = InputManager.Ins as InputManager | null;
        if (input?.IsDraggingItem()) {
            input.EndInteraction();
        } else {
            draggable.EndDrag();
        }

        draggable.returnToStartOnDragFailed = returnOnFail;
        draggable.spawnBreakHeartOnDropFail = breakHeartOnFail;
    }

    private shiftLinkedNodes(): void {
        if (this.shiftOffset.equals(Vec3.ZERO)) return;
        for (const node of this.shiftNodes) {
            if (!node?.isValid) continue;
            if (this.shiftJumpHeight === 0) {
                tween(node)
                    .delay(this.inDelay)
                    .by(this.shiftDuration, { position: this.shiftOffset.clone() }, { easing: 'sineInOut' })
                    .start();
                continue;
            }

            // Nhảy theo cung: dịch shiftOffset, cộng thêm độ cao parabol ở giữa đường.
            const offset = this.shiftOffset.clone();
            const height = this.shiftJumpHeight;
            const squash = Math.max(0, this.shiftSquash);
            const anticipation = squash > 0 ? 0.1 : 0;
            this.playJumpSquash(node, squash, anticipation);

            const state = { t: 0 };
            let start: Vec3 | null = null;
            tween(state)
                .delay(this.inDelay + anticipation)
                .call(() => { start = node.position.clone(); })
                .to(this.shiftDuration, { t: 1 }, {
                    easing: 'sineInOut',
                    onUpdate: () => {
                        if (!start || !node.isValid) return;
                        const t = state.t;
                        node.setPosition(
                            start.x + offset.x * t,
                            start.y + offset.y * t + height * 4 * t * (1 - t),
                            start.z + offset.z * t,
                        );
                    },
                })
                .start();
        }
    }

    /** Nhún: bẹp lấy đà -> vươn khi bay -> bẹp khi chạm đất -> nảy về scale gốc. */
    private playJumpSquash(node: Node, amount: number, anticipation: number): void {
        if (amount <= 0) return;
        const base = node.scale.clone();
        const scaleOf = (sx: number, sy: number) => new Vec3(base.x * sx, base.y * sy, base.z);
        const half = this.shiftDuration * 0.5;
        tween(node)
            .delay(this.inDelay)
            .to(anticipation, { scale: scaleOf(1 + amount, 1 - amount) }, { easing: 'quadOut' })
            .to(half, { scale: scaleOf(1 - amount * 0.5, 1 + amount * 0.5) }, { easing: 'sineOut' })
            .to(half, { scale: base }, { easing: 'sineIn' })
            .to(0.08, { scale: scaleOf(1 + amount * 0.8, 1 - amount * 0.8) }, { easing: 'quadOut' })
            .to(0.2, { scale: base }, { easing: 'backOut' })
            .start();
    }

    private getLinkedState(node: Node): LinkedNodeState {
        let state = this._linkedStates.get(node);
        if (!state) {
            state = { shownPos: node.position.clone() };
            this._linkedStates.set(node, state);
        }
        return state;
    }

    private slideLinkedIn(node: Node, onComplete: () => void): void {
        if (node.activeInHierarchy) {
            onComplete();
            return;
        }

        const state = this.getLinkedState(node);
        Tween.stopAllByTarget(node);
        node.active = true;
        node.setPosition(state.shownPos.x, state.shownPos.y - this.slideDistance, state.shownPos.z);
        tween(node)
            .delay(this.inDelay)
            .to(this.inDuration, { position: state.shownPos }, { easing: 'backOut' })
            .call(onComplete)
            .start();
    }

    private slideLinkedOut(node: Node, onComplete: () => void): void {
        const state = this.getLinkedState(node);
        Tween.stopAllByTarget(node);
        if (!node.activeInHierarchy) {
            node.active = false;
            onComplete();
            return;
        }
        const from = node.position;
        tween(node)
            .to(this.outDuration, { position: new Vec3(from.x, from.y - this.slideDistance, from.z) }, { easing: 'backIn' })
            .call(() => {
                node.active = false;
                node.setPosition(state.shownPos);
                onComplete();
            })
            .start();
    }
}
