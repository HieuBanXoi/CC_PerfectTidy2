import { _decorator, Component, Enum, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import { ItemClickable } from '../Components/ItemClickable';
import { FxType, Ply_SoundManager } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

/**
 * Cánh tủ đóng/mở bằng click (bấm thoải mái, không giới hạn số lần).
 * - Tủ đóng: bật closedNodes (door_CloseLeft/Right, đè lên Holders để che item đã đặt), tắt openNodes.
 *   Holder nằm trong vùng closedNodes -> item KHÔNG snap vào được (ItemSnap.CanPlaced trả false).
 * - Tủ mở: ngược lại, snap bình thường.
 * Mỗi node cánh (cả đóng lẫn mở) được gắn ItemClickable để InputManager bắt click (item kéo được ưu tiên hơn).
 */
@ccclass('CabinetDoor')
export class CabinetDoor extends Component {
    @property({ type: [Node], tooltip: 'Các cánh tủ lúc mở (Doors/Left, Doors/Right).' })
    public openNodes: Node[] = [];

    @property({ type: [Node], tooltip: 'Các cánh tủ lúc đóng (Cover/door_CloseLeft, door_CloseRight). Vùng của chúng là vùng chặn snap khi đóng.' })
    public closedNodes: Node[] = [];

    @property({ tooltip: 'Vào game tủ đang đóng.' })
    public startClosed = true;

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

    @property({ type: Enum(FxType), tooltip: 'Sound khi đóng/mở tủ.' })
    public toggleFxType: FxType = FxType.Click;

    @property({ type: Ply_Event, tooltip: 'Gọi khi tủ mở.' })
    public onOpened: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi tủ đóng.' })
    public onClosed: Ply_Event = new Ply_Event();

    private static readonly _instances: CabinetDoor[] = [];

    private _isClosed = false;
    private _isAnimating = false;
    private readonly _baseScales = new Map<Node, Vec3>();
    private readonly _onDoorClick = () => this.Toggle();

    public get IsClosed(): boolean {
        return this._isClosed;
    }

    public resetInEditor(): void {
        if (!this.onOpened) this.onOpened = new Ply_Event();
        if (!this.onClosed) this.onClosed = new Ply_Event();
    }

    protected onLoad(): void {
        CabinetDoor._instances.push(this);
        for (const n of [...this.openNodes, ...this.closedNodes]) {
            if (!n) continue;
            this._baseScales.set(n, n.scale.clone());
            const clickable = n.getComponent(ItemClickable) ?? n.addComponent(ItemClickable);
            clickable.infiniteClick = true;
            clickable.onClick.addListener(this._onDoorClick);
        }
        this.applyState(this.startClosed);
    }

    protected onDestroy(): void {
        const idx = CabinetDoor._instances.indexOf(this);
        if (idx >= 0) CabinetDoor._instances.splice(idx, 1);
        for (const n of [...this.openNodes, ...this.closedNodes]) {
            n?.isValid && n.getComponent(ItemClickable)?.onClick.removeListener(this._onDoorClick);
        }
    }

    public Toggle(): void {
        if (this._isClosed) this.Open();
        else this.Close();
    }

    public Open(): void {
        this.setClosed(false);
    }

    public Close(): void {
        this.setClosed(true);
    }

    private setClosed(closed: boolean): void {
        if (this._isAnimating || this._isClosed === closed) return;
        if (GameManager.Ins && !GameManager.Ins.IsPlaying()) return;

        Ply_SoundManager.Ins?.PlayFx(this.toggleFxType);
        (GameManager.Ins as any)?.ResetInactivityTimer?.(null);
        this.applyState(closed);

        // Cánh vừa hiện: bật từ mỏng ra đủ (giả lập xoay bản lề).
        this._isAnimating = true;
        const shown = closed ? this.closedNodes : this.openNodes;
        for (const n of shown) {
            if (!n) continue;
            const s = this._baseScales.get(n) ?? Vec3.ONE;
            Tween.stopAllByTarget(n);
            n.setScale(s.x * 0.3, s.y, s.z);
            tween(n).to(this.toggleDuration, { scale: s }, { easing: 'backOut' }).start();
        }
        this.scheduleOnce(() => { this._isAnimating = false; }, this.toggleDuration);

        if (closed) this.onClosed.invoke();
        else this.onOpened.invoke();
    }

    private applyState(closed: boolean): void {
        this._isClosed = closed;
        for (const n of this.openNodes) if (n) n.active = !closed;
        for (const n of this.closedNodes) {
            if (!n) continue;
            n.active = closed;
            const s = this._baseScales.get(n);
            if (s) n.setScale(s);
        }
    }

    /** Điểm world có nằm trong vùng cánh đóng (đang đóng) không. */
    public IsPointBlocked(worldPos: Vec3, margin: number = this.blockMargin): boolean {
        if (!this._isClosed) return false;
        return this.closedNodes.some(n => !!n && n.activeInHierarchy && CabinetDoor.isInsideRect(n, worldPos, margin));
    }

    /** Holder nằm sau cánh tủ đang đóng -> không snap được. */
    public static IsHolderBlocked(holder: Node | null): boolean {
        if (!holder || !holder.isValid) return false;
        const pos = holder.worldPosition;
        return CabinetDoor._instances.some(d => d.enabledInHierarchy && d.IsPointBlocked(pos));
    }

    /**
     * Item thả đè lên cánh đóng sẽ bị cánh (Cover) che mất -> trả về vị trí world ngay phía trên cánh để đẩy item ra.
     * Null nếu điểm không bị chặn.
     */
    public static GetPushOutPosition(worldPos: Vec3): Vec3 | null {
        for (const d of CabinetDoor._instances) {
            if (!d.enabledInHierarchy || !d.pushOutDroppedItems || !d.IsPointBlocked(worldPos, 0)) continue;
            let top = -Infinity;
            for (const n of d.closedNodes) {
                const ut = n?.getComponent(UITransform);
                if (!n || !n.activeInHierarchy || !ut) continue;
                top = Math.max(top, ut.getBoundingBoxToWorld().yMax);
            }
            return new Vec3(worldPos.x, top + d.dropPushOutPadding, worldPos.z);
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
