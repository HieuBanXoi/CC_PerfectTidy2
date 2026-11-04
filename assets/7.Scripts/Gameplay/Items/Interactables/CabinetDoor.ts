import { _decorator, Component, Enum, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { ItemClickable } from '../Components/ItemClickable';
import { FxType, Ply_SoundManager } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { GameManager } from '../../Systems/GameManager';
import { HandHintRequest, HandHintSource, IdleHandHint } from '../../Systems/IdleHandHint';

/** Phần ItemSnap mà cánh tủ cần đọc (tra theo tên class để không import vòng với ItemSnap). */
interface WaitingItemLike {
    node: Node;
    enabled: boolean;
    currentState: number;
    correctHolderTransform: Node | null;
    AreRequiredItemsPlaced(): boolean;
}
const ITEM_STATE_WAITING = 0;

const { ccclass, property } = _decorator;

/**
 * Cánh tủ đóng/mở bằng click (bấm thoải mái, không giới hạn số lần).
 * - Mỗi cánh i = cặp (openNodes[i], closedNodes[i]), đóng/mở riêng biệt (bật linkLeaves để đóng/mở cùng nhau).
 * - Cánh đóng: bật closedNodes[i] (đè lên Holders để che item đã đặt), tắt openNodes[i].
 *   Holder nằm trong vùng cánh đang đóng -> item KHÔNG snap vào được (ItemSnap.CanPlaced trả false).
 * - Cánh mở: ngược lại, holder phía sau cánh đó snap bình thường.
 * Mỗi node cánh được gắn ItemClickable để InputManager bắt click (item kéo được ưu tiên hơn).
 * Nguồn gợi ý cho IdleHandHint: có item đang chờ mà chỗ đặt nằm sau 1 cánh đang đóng -> tay nhấn vào cánh đó.
 */
@ccclass('CabinetDoor')
export class CabinetDoor extends Component implements HandHintSource {
    /** Thứ tự ưu tiên trong IdleHandHint: sau gợi ý kéo item, trước gợi ý bấm hộp. */
    public static readonly HINT_PRIORITY = 10;

    @property({ type: [Node], tooltip: 'Các cánh tủ lúc mở, cùng thứ tự với closedNodes (ví dụ: door_open_1 = trái, door_open_2 = phải).' })
    public openNodes: Node[] = [];

    @property({ type: [Node], tooltip: 'Các cánh tủ lúc đóng, cùng thứ tự với openNodes (door_CloseLeft, door_CloseRight). Vùng của chúng là vùng chặn snap khi đóng.' })
    public closedNodes: Node[] = [];

    @property({ tooltip: 'Vào game các cánh đang đóng.' })
    public startClosed = true;

    @property({ tooltip: 'Bấm 1 cánh thì tất cả các cánh cùng đóng/mở. Tắt: mỗi cánh đóng/mở riêng.' })
    public linkLeaves = false;

    @property({ min: 0, tooltip: 'Khoảng nới thêm (world) quanh vùng cánh đóng khi xét holder bị chặn.' })
    public blockMargin = 0;

    @property({ tooltip: 'Bật khi cánh đóng nằm TRÊN Items (ví dụ trong Cover): item thả đè lên cánh bị che mất nên đẩy item ra phía trên cánh.' })
    public pushOutDroppedItems = false;

    @property({
        min: 0,
        tooltip: 'Khoảng cách (world) đẩy item ra khỏi cánh đóng.',
        visible(this: CabinetDoor) { return this.pushOutDroppedItems; }
    })
    public dropPushOutPadding = 40;

    @property({ min: 0.01, tooltip: 'Thời gian hiệu ứng đóng/mở (giây).' })
    public toggleDuration = 0.18;

    @property({ type: Enum(FxType), tooltip: 'Sound khi đóng/mở cánh.' })
    public toggleFxType: FxType = FxType.Click;

    @property({ type: Ply_Event, tooltip: 'Gọi khi 1 cánh mở (tham số: index cánh).' })
    public onOpened: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi 1 cánh đóng (tham số: index cánh).' })
    public onClosed: Ply_Event = new Ply_Event();

    private static readonly _instances: CabinetDoor[] = [];

    private readonly _closed: boolean[] = [];
    private readonly _animating: boolean[] = [];
    private readonly _baseScales = new Map<Node, Vec3>();
    private readonly _clickHandlers = new Map<Node, () => void>();

    /** Số cánh (cặp open/closed). */
    public get LeafCount(): number {
        return Math.max(this.openNodes.length, this.closedNodes.length);
    }

    /** Tất cả các cánh đều đang đóng. */
    public get IsClosed(): boolean {
        return this._closed.length > 0 && this._closed.every(c => c);
    }

    public IsLeafClosed(index: number): boolean {
        return !!this._closed[index];
    }

    public resetInEditor(): void {
        if (!this.onOpened) this.onOpened = new Ply_Event();
        if (!this.onClosed) this.onClosed = new Ply_Event();
    }

    // ==================== LIFECYCLE ====================

    protected onLoad(): void {
        CabinetDoor._instances.push(this);
        for (let i = 0; i < this.LeafCount; i++) {
            for (const n of [this.openNodes[i], this.closedNodes[i]]) {
                if (!n) continue;
                this._baseScales.set(n, n.scale.clone());
                const handler = () => this.onLeafClick(i);
                this._clickHandlers.set(n, handler);
                const clickable = n.getComponent(ItemClickable) ?? n.addComponent(ItemClickable);
                clickable.infiniteClick = true;
                clickable.onClick.addListener(handler);
            }
            this.applyLeaf(i, this.startClosed);
        }
    }

    protected onEnable(): void {
        IdleHandHint.Register(this, CabinetDoor.HINT_PRIORITY);
    }

    protected onDisable(): void {
        IdleHandHint.Unregister(this);
    }

    protected onDestroy(): void {
        const idx = CabinetDoor._instances.indexOf(this);
        if (idx >= 0) CabinetDoor._instances.splice(idx, 1);
        for (const [n, handler] of this._clickHandlers) {
            if (n.isValid) n.getComponent(ItemClickable)?.onClick.removeListener(handler);
        }
        this._clickHandlers.clear();
    }

    // ==================== ĐÓNG / MỞ ====================

    /** Đổi trạng thái 1 cánh (hoặc tất cả nếu linkLeaves). */
    public ToggleLeaf(index: number): void {
        this.SetLeafClosed(index, !this._closed[index]);
    }

    /** Đóng/mở 1 cánh (hoặc tất cả nếu linkLeaves). */
    public SetLeafClosed(index: number, closed: boolean): void {
        if (!this.linkLeaves) {
            this.setLeaf(index, closed);
            return;
        }
        for (let i = 0; i < this.LeafCount; i++) this.setLeaf(i, closed, i === index);
    }

    /** Tất cả cánh: đang có cánh đóng thì mở hết, không thì đóng hết. */
    public Toggle(): void {
        if (this._closed.some(c => c)) this.Open();
        else this.Close();
    }

    public Open(): void {
        for (let i = 0; i < this.LeafCount; i++) this.setLeaf(i, false, i === 0);
    }

    public Close(): void {
        for (let i = 0; i < this.LeafCount; i++) this.setLeaf(i, true, i === 0);
    }

    private onLeafClick(index: number): void {
        this.ToggleLeaf(index);
    }

    /** playSound: khi đổi nhiều cánh cùng lúc chỉ phát sound 1 lần. */
    private setLeaf(index: number, closed: boolean, playSound: boolean = true): void {
        if (this._animating[index] || this._closed[index] === closed) return;
        if (GameManager.Ins && !GameManager.Ins.IsPlaying()) return;

        if (playSound) Ply_SoundManager.Ins?.PlayFx(this.toggleFxType);
        GameManager.Ins?.ResetInactivityTimer(null);
        this.applyLeaf(index, closed);

        // Cánh vừa hiện: bật từ mỏng ra đủ (giả lập xoay bản lề).
        const shown = closed ? this.closedNodes[index] : this.openNodes[index];
        if (shown) {
            const s = this._baseScales.get(shown) ?? Vec3.ONE;
            Tween.stopAllByTarget(shown);
            shown.setScale(s.x * 0.3, s.y, s.z);
            tween(shown).to(this.toggleDuration, { scale: s }, { easing: 'backOut' }).start();
        }
        this._animating[index] = true;
        this.scheduleOnce(() => { this._animating[index] = false; }, this.toggleDuration);

        if (closed) this.onClosed.invoke(index);
        else this.onOpened.invoke(index);
    }

    private applyLeaf(index: number, closed: boolean): void {
        this._closed[index] = closed;
        const open = this.openNodes[index];
        const close = this.closedNodes[index];
        if (open) open.active = !closed;
        if (close) {
            close.active = closed;
            const s = this._baseScales.get(close);
            if (s) close.setScale(s);
        }
    }

    // ==================== GỢI Ý TAY ====================

    /** HandHintSource: cánh đang đóng che chỗ đặt của 1 item đang chờ (đã đủ requiredItems) -> nhấn vào cánh đó. */
    public GetHandHint(): HandHintRequest | null {
        if (!this._closed.some(c => c)) return null;
        const items = (this.node.scene?.getComponentsInChildren('ItemSnap') ?? []) as unknown as WaitingItemLike[];
        for (const item of items) {
            if (!item.enabled || item.currentState !== ITEM_STATE_WAITING || !item.node.activeInHierarchy) continue;
            const holder = item.correctHolderTransform;
            if (!holder?.isValid || !item.AreRequiredItemsPlaced()) continue;

            const leaf = this.getClosedLeafAt(holder.worldPosition, this.blockMargin);
            if (!leaf) continue;
            const index = this.closedNodes.indexOf(leaf);
            return { kind: 'tap', target: leaf, canContinue: () => !!this._closed[index] };
        }
        return null;
    }

    // ==================== CHẶN SNAP ====================

    /** Điểm world có nằm sau 1 cánh đang đóng không. */
    public IsPointBlocked(worldPos: Vec3, margin: number = this.blockMargin): boolean {
        return this.getClosedLeafAt(worldPos, margin) !== null;
    }

    /** Holder nằm sau cánh tủ đang đóng -> không snap được. */
    public static IsHolderBlocked(holder: Node | null): boolean {
        if (!holder || !holder.isValid) return false;
        const pos = holder.worldPosition;
        return CabinetDoor._instances.some(d => d.enabledInHierarchy && d.IsPointBlocked(pos));
    }

    /**
     * Item thả đè lên cánh đóng sẽ bị cánh che mất -> trả về vị trí world ngay phía trên cánh đó để đẩy item ra.
     * Null nếu điểm không bị chặn.
     */
    public static GetPushOutPosition(worldPos: Vec3): Vec3 | null {
        for (const d of CabinetDoor._instances) {
            if (!d.enabledInHierarchy || !d.pushOutDroppedItems) continue;
            const leaf = d.getClosedLeafAt(worldPos, 0);
            const top = leaf?.getComponent(UITransform)?.getBoundingBoxToWorld().yMax;
            if (top !== undefined) return new Vec3(worldPos.x, top + d.dropPushOutPadding, worldPos.z);
        }
        return null;
    }

    /** Node cánh đóng (đang đóng) chứa điểm worldPos, null nếu không có. */
    private getClosedLeafAt(worldPos: Vec3, margin: number): Node | null {
        for (let i = 0; i < this.closedNodes.length; i++) {
            const n = this.closedNodes[i];
            if (this._closed[i] && n?.activeInHierarchy && CabinetDoor.isInsideRect(n, worldPos, margin)) return n;
        }
        return null;
    }

    private static isInsideRect(node: Node, worldPos: Vec3, margin: number): boolean {
        const ut = node.getComponent(UITransform);
        if (!ut) return false;
        const box = ut.getBoundingBoxToWorld();
        return worldPos.x >= box.xMin - margin && worldPos.x <= box.xMax + margin
            && worldPos.y >= box.yMin - margin && worldPos.y <= box.yMax + margin;
    }
}
