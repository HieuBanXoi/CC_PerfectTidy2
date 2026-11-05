import { _decorator, Component, Node, Tween, tween, UITransform, Vec2, Vec3, v2, v3 } from 'cc';
import { GridPiece } from './GridPiece';
const { ccclass, property, requireComponent } = _decorator;

/**
 * HỘP CON (Box_2x2, Box_1x2...)
 * -------------------------------------------------------------
 * - Đi kèm GridPiece trên cùng node (hộp cũng là 1 piece sizeW x sizeH khi đặt vào Main Box).
 * - Nhận item CÙNG LOẠI, xếp chồng lên nhau. Đủ `capacity` cái -> đóng nắp (Cover_Open ẩn, Cover_Close hiện).
 * - Chỉ kéo hộp vào Main Box được khi đã đóng. Hộp đang mở có thể lấy item ra lại.
 */
@ccclass('PackContainer')
@requireComponent(GridPiece)
export class PackContainer extends Component {
    public static readonly EVENT_CLOSED = 'pack-container-closed';
    public static readonly EVENT_CHANGED = 'pack-container-changed';

    @property({ tooltip: 'Số item cần để đóng nắp' })
    public capacity = 3;

    @property({ tooltip: 'Chỉ nhận item có đúng kích thước ô bằng hộp. Bỏ tích = nhận item nhỏ hơn hoặc bằng.' })
    public exactSize = true;

    @property({ type: Node, tooltip: 'Nắp lúc mở (hiện khi hộp chưa đủ đồ)' })
    public coverOpen: Node | null = null;

    @property({ type: Node, tooltip: 'Nắp lúc đóng (hiện khi đủ đồ)' })
    public coverClose: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa item bên trong. Để trống = tự tạo "Content" ngay trên node "Main".' })
    public contentRoot: Node | null = null;

    @property({ tooltip: 'Lòng hộp chiếm bao nhiêu % kích thước hộp (item luôn nằm gọn trong vùng này, kể cả khi xếp chồng)', range: [0.2, 1, 0.01] })
    public contentFill = 0.75;

    @property({ tooltip: 'Độ lệch giữa các item chồng lên nhau (local của hộp)' })
    public stackStep: Vec2 = v2(40, 30);

    @property({ tooltip: 'Thời gian tween nắp đóng' })
    public closeDuration = 0.3;

    @property({ tooltip: 'Hộp bắt đầu ở trạng thái đóng (chạm để mở)' })
    public startClosed = true;

    @property({ tooltip: 'Đủ đồ thì tự đóng nắp' })
    public autoCloseWhenFull = true;

    private _items: GridPiece[] = [];
    private _closed = false;
    private _piece: GridPiece = null!;
    private readonly _coverClosePos = v3();
    private readonly _coverCloseScale = v3(1, 1, 1);
    private readonly _baseScale = v3(1, 1, 1);

    public get piece() { return this._piece; }
    /** Scale gốc của hộp trên sàn (chụp lúc onLoad, không bị ảnh hưởng bởi tween). */
    public get baseScale(): Readonly<Vec3> { return this._baseScale; }
    public get isClosed() { return this._closed; }
    public get count() { return this._items.length; }
    public get items(): readonly GridPiece[] { return this._items; }
    public get acceptedType(): string | null { return this._items.length ? this._items[0].key : null; }

    protected onLoad() {
        this._piece = this.getComponent(GridPiece)!;
        this._baseScale.set(this.node.scale);
        this._piece.autoFloorScale = false; // hộp giữ scale đặt trong scene
        this._piece.boardLayer = Math.max(this._piece.boardLayer, 1); // trên Main Box: hộp luôn nằm trên food
        if (!this.coverOpen) this.coverOpen = this.node.getChildByName('Cover_Open');
        if (!this.coverClose) this.coverClose = this.node.getChildByName('Cover_Close');
        if (!this.contentRoot) {
            let root = this.node.getChildByName('Content');
            if (!root) {
                root = new Node('Content');
                root.layer = this.node.layer;
                root.addComponent(UITransform);
                this.node.addChild(root);
            }
            const main = this.node.getChildByName('Main');
            root.setSiblingIndex(main ? main.getSiblingIndex() + 1 : 0);
            this.contentRoot = root;
        }
        if (this.coverClose) {
            this._coverClosePos.set(this.coverClose.position);
            this._coverCloseScale.set(this.coverClose.scale);
        }
        this._closed = this.startClosed;
        if (this.coverClose) this.coverClose.active = this._closed;
        if (this.coverOpen) this.coverOpen.active = !this._closed;
    }

    /** Có nhận món này không (bỏ qua trạng thái đóng/mở). Dùng cho tay gợi ý "mở hộp". */
    public wouldAccept(p: GridPiece): boolean {
        const was = this._closed;
        this._closed = false;
        const ok = this.canAccept(p);
        this._closed = was;
        return ok;
    }

    /** Chạm vào hộp: đang đóng thì mở, đang mở thì đóng. */
    public toggle() {
        if (this._closed) this.open();
        else this.close();
    }

    /** Mở nắp: nắp đóng nhấc lên rồi chuyển thành nắp mở. */
    public open() {
        if (!this._closed) return;
        this._closed = false;
        const open = this.coverOpen;
        const cover = this.coverClose;
        if (cover) {
            Tween.stopAllByTarget(cover);
            cover.active = true;
            const to = open ? open.position.clone() : v3(this._coverClosePos.x, this._coverClosePos.y + 200, 0);
            tween(cover)
                .to(this.closeDuration * 0.8, { position: to }, { easing: 'quadOut' })
                .call(() => {
                    cover.active = false;
                    cover.setPosition(this._coverClosePos);
                    if (open && !this._closed) open.active = true;
                })
                .start();
        } else if (open) {
            open.active = true;
        }
        this.bounce(0);
        this.node.emit(PackContainer.EVENT_CHANGED, this);
    }

    private bounce(delay: number) {
        const base = this.node.scale.clone();
        if (this._piece.isOnFloor) base.set(this._baseScale);
        Tween.stopAllByTarget(this.node);
        this.node.setScale(base);
        tween(this.node)
            .delay(delay)
            .to(0.08, { scale: v3(base.x * 1.08, base.y * 0.94, 1) })
            .to(0.12, { scale: base }, { easing: 'backOut' })
            .start();
    }

    public canAccept(p: GridPiece): boolean {
        if (this._closed || p === this._piece || p.getComponent(PackContainer)) return false;
        if (this._items.length >= this.capacity) return false;
        const box = this._piece;
        const sizeOk = this.exactSize
            ? (p.sizeW === box.sizeW && p.sizeH === box.sizeH)
            : (p.sizeW <= box.sizeW && p.sizeH <= box.sizeH);
        if (!sizeOk) return false;
        const t = this.acceptedType;
        return t === null || t === p.key;
    }

    /** Vị trí (local trong contentRoot) của item thứ i. */
    private slotPos(i: number, out = v3()): Vec3 {
        const mid = (this.capacity - 1) / 2;
        return out.set((i - mid) * this.stackStep.x, -(i - mid) * this.stackStep.y, 0);
    }

    /**
     * Scale local (trong contentRoot) để item nằm GỌN trong lòng hộp:
     * vùng lòng hộp = kích thước hộp * contentFill, trừ đi khoảng lệch khi xếp chồng -> không tràn ra ngoài.
     */
    private slotScale(p: GridPiece): number {
        const ut = this.node.getComponent(UITransform)!;
        const s = p.getContentSize();
        const spreadX = Math.abs(this.stackStep.x) * Math.max(0, this.capacity - 1);
        const spreadY = Math.abs(this.stackStep.y) * Math.max(0, this.capacity - 1);
        const availW = Math.max(10, ut.width * this.contentFill - spreadX);
        const availH = Math.max(10, ut.height * this.contentFill - spreadY);
        return Math.min(availW / s.w, availH / s.h);
    }

    /** Thời gian món bay vòng cung vào hộp. */
    public static readonly SWALLOW_TIME = 0.34;

    /**
     * Cho item vào hộp (item đã được controller gỡ khỏi chỗ cũ).
     * Món bay theo đường cong vào lòng hộp, hộp phình ra như vừa "nuốt", đủ đồ thì đóng nắp.
     */
    public add(p: GridPiece, duration = PackContainer.SWALLOW_TIME): boolean {
        if (!this.canAccept(p)) return false;
        this._items.push(p);
        p.container = this;
        p.board = null;

        const root = this.contentRoot!;
        const slot = this.slotPos(this._items.length - 1);
        const sLocal = this.slotScale(p);
        const endWorld = root.getComponent(UITransform)!.convertToWorldSpaceAR(slot);
        const endWorldScale = sLocal * Math.abs(root.worldScale.x);

        // Bay trong parent hiện tại (thường là layer kéo, vẽ trên cùng) rồi mới cho vào hộp.
        const parent = p.node.parent!;
        const parentUT = parent.getComponent(UITransform);
        const ps = Math.abs(parent.worldScale.x) || 1;
        const start = p.node.position.clone();
        const end = parentUT ? parentUT.convertToNodeSpaceAR(endWorld) : endWorld.clone();
        const peakY = Math.max(start.y, end.y) + 140 / ps;
        const s0 = p.node.scale.x;
        const s1 = endWorldScale / ps;
        const a0 = p.node.angle;
        const a1 = p.baseAngle;
        const t = { k: 0 };
        Tween.stopAllByTarget(p.node);
        tween(t)
            .to(duration, { k: 1 }, {
                easing: 'sineIn',
                onUpdate: () => {
                    if (p.container !== this) return; // bị nhấc ra giữa chừng
                    const k = t.k, u = 1 - k;
                    p.node.setPosition(
                        start.x + (end.x - start.x) * k,
                        u * u * start.y + 2 * u * k * peakY + k * k * end.y,
                        0,
                    );
                    const sc = (s0 + (s1 - s0) * k) * (1 + 0.15 * Math.sin(k * Math.PI));
                    p.node.setScale(sc, sc, 1);
                    p.node.angle = a0 + (a1 - a0) * k + Math.sin(k * Math.PI) * 20;
                },
            })
            .call(() => {
                if (p.container !== this) return; // đã bị lấy ra giữa chừng
                p.node.setParent(root, true);
                p.node.setPosition(this.slotPos(this._items.indexOf(p)));
                p.node.setScale(sLocal, sLocal, 1);
                p.node.angle = a1;
                this.gulp();
                if (this.autoCloseWhenFull && this._items.length >= this.capacity && !this._closed) this.scheduleOnce(() => this.close(), 0.15);
            })
            .start();
        this.node.emit(PackContainer.EVENT_CHANGED, this);
        return true;
    }

    /** Hộp phình ra như vừa nuốt. */
    public gulp() {
        const base = this._piece.isOnFloor ? this._baseScale.clone() : this.node.scale.clone();
        Tween.stopAllByTarget(this.node);
        this.node.setScale(base);
        tween(this.node)
            .to(0.08, { scale: v3(base.x * 1.14, base.y * 0.88, base.z) }, { easing: 'quadOut' })
            .to(0.1, { scale: v3(base.x * 0.95, base.y * 1.08, base.z) })
            .to(0.14, { scale: base }, { easing: 'backOut' })
            .start();
    }

    public removeItem(p: GridPiece): boolean {
        if (this._closed) return false;
        const i = this._items.indexOf(p);
        if (i < 0) return false;
        this._items.splice(i, 1);
        p.container = null;
        // Dồn lại vị trí các item còn lại.
        this._items.forEach((it, idx) => {
            Tween.stopAllByTarget(it.node);
            tween(it.node).to(0.12, { position: this.slotPos(idx) }).start();
        });
        this.node.emit(PackContainer.EVENT_CHANGED, this);
        return true;
    }

    /** Đóng nắp. */
    public close() {
        if (this._closed) return;
        this._closed = true;
        const open = this.coverOpen;
        const cover = this.coverClose;
        if (open) open.active = false;
        if (cover) {
            cover.active = true;
            cover.setSiblingIndex(this.node.children.length - 1);
            const from = open ? open.position.clone() : v3(this._coverClosePos.x, this._coverClosePos.y + 200, 0);
            cover.setPosition(from);
            cover.setScale(this._coverCloseScale);
            Tween.stopAllByTarget(cover);
            tween(cover)
                .to(this.closeDuration, { position: this._coverClosePos }, { easing: 'quadIn' })
                .call(() => this.node.emit(PackContainer.EVENT_CLOSED, this))
                .start();
        } else {
            this.node.emit(PackContainer.EVENT_CLOSED, this);
        }
        // Nảy nhẹ cả hộp.
        this.bounce(this.closeDuration);
        this.node.emit(PackContainer.EVENT_CHANGED, this);
    }
}
