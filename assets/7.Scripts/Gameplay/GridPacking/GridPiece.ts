import { _decorator, Color, Component, EventTouch, Node, Sprite, UITransform, Vec2, Vec3, v2, v3 } from 'cc';
import { GridBoard, IGridOccupant } from './GridBoard';
const { ccclass, property } = _decorator;

/**
 * GRID PIECE (dùng lại được)
 * -------------------------------------------------------------
 * Vật kéo thả chiếm sizeW x sizeH ô trên GridBoard. Không tự xoay.
 * - itemType: khoá "cùng loại". Để trống = lấy tên spriteFrame.
 * - Touch được chuyển cho GridPackManager (controller) xử lý.
 * - Vị trí ban đầu trong scene = "chỗ trên sàn" (floor home), bay về đây khi thả ra ngoài.
 */
@ccclass('GridPiece')
export class GridPiece extends Component implements IGridOccupant {

    @property({ tooltip: 'Số ô theo chiều ngang' })
    public sizeW = 1;

    @property({ tooltip: 'Số ô theo chiều dọc' })
    public sizeH = 1;

    @property({ tooltip: 'Khoá cùng loại (để trống = tên spriteFrame)' })
    public itemType = '';

    @property({ tooltip: 'Tỉ lệ lấp ô khi nằm trên lưới (1 = vừa khít vùng ô)', range: [0.3, 1.2, 0.01] })
    public boardFill = 0.9;

    @property({ tooltip: 'Tự set scale trên sàn = scale vừa lưới * floorScale. Bỏ tích = giữ scale đang set trong scene.' })
    public autoFloorScale = true;

    @property({ tooltip: 'Kích thước trên sàn so với khi nằm trên lưới', range: [0.3, 1.5, 0.01], visible(this: GridPiece) { return this.autoFloorScale; } })
    public floorScale = 0.85;

    @property({ tooltip: 'Lời giải cho tay gợi ý: index Main Box (-1 = không set, tay tự tìm ô trống)' })
    public solutionBoard = -1;

    @property({ tooltip: 'Lời giải: cột góc trái-trên', visible(this: GridPiece) { return this.solutionBoard >= 0; } })
    public solutionCol = 0;

    @property({ tooltip: 'Lời giải: hàng góc trái-trên', visible(this: GridPiece) { return this.solutionBoard >= 0; } })
    public solutionRow = 0;

    @property({ tooltip: 'Thứ tự lớp khi nằm trên lưới: số lớn vẽ trên. Hộp con tự đặt = 1 (luôn trên food).' })
    public boardLayer = 0;

    // ------------------------------------------------ Bóng đổ
    @property({ tooltip: 'Bóng đổ dưới vật (bóng = silhouette của chính sprite)' })
    public shadowEnabled = true;

    @property({ type: Color, tooltip: 'Màu + độ đậm bóng', visible(this: GridPiece) { return this.shadowEnabled; } })
    public shadowColor: Color = new Color(40, 20, 5, 120);

    @property({ tooltip: 'Lệch bóng khi nằm yên (px world)', visible(this: GridPiece) { return this.shadowEnabled; } })
    public shadowOffset: Vec2 = v2(10, -14);

    @property({ tooltip: 'Lệch bóng khi đang nhấc lên (px world)', visible(this: GridPiece) { return this.shadowEnabled; } })
    public liftShadowOffset: Vec2 = v2(30, -44);

    @property({ tooltip: 'Bóng to ra bao nhiêu khi nhấc lên', visible(this: GridPiece) { return this.shadowEnabled; } })
    public liftShadowScale = 1.1;

    @property({ tooltip: 'Độ đậm bóng khi nhấc lên (so với lúc nằm yên)', range: [0, 1, 0.01], visible(this: GridPiece) { return this.shadowEnabled; } })
    public liftShadowAlpha = 0.45;

    private _shadow: Node | null = null;
    private _shadowSprite: Sprite | null = null;
    private _liftTarget = 0;
    private _lift = 0;

    /** Nhấc lên (bóng to + mờ + xa) / đặt xuống. */
    public setLifted(on: boolean) {
        this._liftTarget = on ? 1 : 0;
    }

    // ------------------------------------------------ Runtime state (controller ghi)
    /** Board đang chứa piece (null nếu không ở trên lưới). */
    public board: GridBoard | null = null;
    public col = -1;
    public row = -1;
    /** Container (hộp con) đang chứa piece. Kiểu any để tránh import vòng. */
    public container: any = null;

    public floorParent: Node | null = null;
    public readonly floorPos = v3();
    public readonly floorWorldScale = v3(1, 1, 1);

    /** Gán bởi GridPackManager. */
    public handler: {
        onPieceTouchStart(p: GridPiece, e: EventTouch): boolean;
        onPieceTouchMove(p: GridPiece, e: EventTouch): void;
        onPieceTouchEnd(p: GridPiece, e: EventTouch): void;
    } | null = null;

    private _dragging = false;

    public get key(): string {
        if (this.itemType) return this.itemType;
        return this.getComponent(Sprite)?.spriteFrame?.name || this.node.name;
    }

    /** Góc xoay gốc của sprite (đặt trong scene). Xoay 90/270 độ -> đổi chiều rộng/cao khi fit vào ô. */
    public baseAngle = 0;
    private _baseAngleCaptured = false;

    public getContentSize(): { w: number; h: number } {
        const ut = this.getComponent(UITransform);
        const w = ut ? ut.width : 100, h = ut ? ut.height : 100;
        const a = ((Math.round((this._baseAngleCaptured ? this.baseAngle : this.node.angle) / 90) % 2) + 2) % 2;
        return a === 1 ? { w: h, h: w } : { w, h };
    }

    /** Scale world để vật vừa vùng sizeW x sizeH ô của board. */
    public getBoardFitWorldScale(board: GridBoard): number {
        const pitch = board.getWorldPitch();
        const s = this.getContentSize();
        return Math.min(this.sizeW * pitch.x * this.boardFill / s.w, this.sizeH * pitch.y * this.boardFill / s.h);
    }

    public get isOnFloor() { return !this.board && !this.container; }
    public get isDragging() { return this._dragging; }
    public set isDragging(v: boolean) { this._dragging = v; }

    /** Ghi nhớ vị trí hiện tại làm chỗ trên sàn. */
    public captureFloorHome() {
        if (!this._baseAngleCaptured) {
            this.baseAngle = this.node.angle;
            this._baseAngleCaptured = true;
        }
        this.floorParent = this.node.parent;
        this.floorPos.set(this.node.position);
        Vec3.copy(this.floorWorldScale, this.node.worldScale);
    }

    protected start() {
        this.createShadow();
    }

    protected onDestroy() {
        if (this._shadow?.isValid) this._shadow.destroy();
    }

    private createShadow() {
        if (!this.shadowEnabled || this._shadow) return;
        const src = this.getComponent(Sprite);
        if (!src || !src.spriteFrame) return;
        const sh = new Node(this.node.name + '_Shadow');
        sh.layer = this.node.layer;
        const ut = sh.addComponent(UITransform);
        const srcUT = this.getComponent(UITransform)!;
        ut.setContentSize(srcUT.contentSize);
        ut.setAnchorPoint(srcUT.anchorPoint);
        const sp = sh.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = src.trim;
        sp.spriteFrame = src.spriteFrame;
        sp.color = this.shadowColor;
        this._shadow = sh;
        this._shadowSprite = sp;
        this.syncShadow(0);
    }

    protected lateUpdate(dt: number) {
        this.syncShadow(dt);
    }

    /** Bóng là node anh em đứng NGAY TRƯỚC vật (vẽ bên dưới), bám theo vị trí / scale / góc. */
    private syncShadow(dt: number) {
        const sh = this._shadow;
        if (!sh || !sh.isValid) return;
        const parent = this.node.parent;
        if (!parent) return;
        const show = this.node.activeInHierarchy && !this.container;
        if (sh.active !== show) sh.active = show;
        // Trên Main Box: bóng vào lớp Shadows riêng (dưới mọi món) -> không đè lên món khác.
        const b = this.board;
        const onBoardLayer = !!(b && b.shadowsRoot && parent === b.piecesRoot);
        const shParent = onBoardLayer ? b!.shadowsRoot! : parent;
        if (sh.parent !== shParent) sh.setParent(shParent, false);
        if (!show) return;

        if (!onBoardLayer) {
            const idx = this.node.getSiblingIndex();
            const sIdx = sh.getSiblingIndex();
            if (sIdx !== idx - 1) sh.setSiblingIndex(sIdx < idx ? idx - 1 : idx);
        }

        this._lift += (this._liftTarget - this._lift) * Math.min(1, dt * 12 || 1);
        const k = this._lift;
        const ps = parent.worldScale;
        const ox = (this.shadowOffset.x + (this.liftShadowOffset.x - this.shadowOffset.x) * k) / (ps.x || 1);
        const oy = (this.shadowOffset.y + (this.liftShadowOffset.y - this.shadowOffset.y) * k) / (ps.y || 1);
        const sc = 1 + (this.liftShadowScale - 1) * k;
        const p = this.node.position, s = this.node.scale;
        sh.setPosition(p.x + ox, p.y + oy, p.z);
        sh.setScale(s.x * sc, s.y * sc, s.z);
        sh.angle = this.node.angle;
        const a = Math.round(this.shadowColor.a * (1 + (this.liftShadowAlpha - 1) * k));
        const sp = this._shadowSprite!;
        if (sp.color.a !== a) {
            const c = sp.color.clone();
            c.a = a;
            sp.color = c;
        }
    }

    protected onEnable() {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    protected onDisable() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    private onTouchStart(e: EventTouch) {
        if (!this.handler) return;
        // Không nhận kéo -> để event nổi lên node cha (VD item trong hộp đã đóng -> kéo cả hộp).
        if (this.handler.onPieceTouchStart(this, e)) {
            this._dragging = true;
            e.propagationStopped = true;
        }
    }

    private onTouchMove(e: EventTouch) {
        if (!this._dragging) return;
        e.propagationStopped = true;
        this.handler?.onPieceTouchMove(this, e);
    }

    private onTouchEnd(e: EventTouch) {
        if (!this._dragging) return;
        e.propagationStopped = true;
        this._dragging = false;
        this.handler?.onPieceTouchEnd(this, e);
    }
}
