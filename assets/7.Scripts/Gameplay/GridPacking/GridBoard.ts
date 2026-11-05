import { _decorator, Color, Component, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3, v3 } from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass, property, executionOrder } = _decorator;

/** Bất kỳ thứ gì chiếm ô trên GridBoard (item, hộp con...) chỉ cần có kích thước theo ô. */
export interface IGridOccupant {
    readonly sizeW: number;
    readonly sizeH: number;
}

export interface GridCellCoord {
    col: number;
    row: number;
}

/**
 * GRID BOARD (dùng lại được)
 * -------------------------------------------------------------
 * - Lưới cols x rows. Ô (col,row) với (0,0) là ô TRÁI-TRÊN, col tăng sang phải, row tăng xuống dưới.
 * - Mỗi ô là 1 node con có Sprite (VD "WhiteBorder"). Để trống `cells` thì tự gom node con có tên bắt đầu
 *   bằng `cellNamePrefix`, tự sắp theo vị trí (không phụ thuộc thứ tự trong Hierarchy).
 * - Khoảng cách giữa các ô (pitch) tự tính từ vị trí các ô.
 * - Màu ô mặc định = màu đang set trên Sprite trong scene; highlight = `highlightColor`.
 * - Chỉ quản lý dữ liệu chiếm chỗ + hiển thị highlight. Việc kéo thả do controller khác (GridPackManager) lo.
 */
@ccclass('GridBoard')
@executionOrder(-10)
export class GridBoard extends Component {
    public static readonly EVENT_CHANGED = 'grid-board-changed';

    @property({ tooltip: 'Số cột' })
    public cols = 3;

    @property({ tooltip: 'Số hàng' })
    public rows = 4;

    @property({ type: [Node], tooltip: 'Các node ô. Để trống = tự gom node con theo cellNamePrefix.' })
    public cells: Node[] = [];

    @property({ tooltip: 'Tiền tố tên node ô khi tự gom' })
    public cellNamePrefix = 'WhiteBorder';

    @property({ tooltip: 'Màu ô khi có thể thả vào' })
    public highlightColor: Color = new Color(70, 215, 90, 200);

    @property({ type: Node, tooltip: 'Node chứa các piece đã đặt. Để trống = tự tạo node con "Pieces" (vẽ trên các ô).' })
    public piecesRoot: Node | null = null;

    /** Lớp bóng đổ: nằm ngay dưới piecesRoot -> bóng của mọi món luôn ở dưới tất cả các món (không đè lên món khác). */
    public shadowsRoot: Node | null = null;

    @property({ type: Node, tooltip: 'Nắp hộp (tuỳ chọn). Ẩn lúc đầu, gọi closeCover() để nắp rơi xuống đậy hộp.' })
    public cover: Node | null = null;

    @property({ tooltip: 'Nắp bắt đầu rơi từ độ cao bao nhiêu (local của board)', visible(this: GridBoard) { return !!this.cover; } })
    public coverDropHeight = 700;

    @property({ tooltip: 'Đồ đặt lên lưới to hơn vùng ô bao nhiêu lần (>1 = tràn viền, đè lên nhau)', range: [0.8, 1.5, 0.01] })
    public placeScale = 1.0;

    @property({ tooltip: 'Lệch vị trí ngẫu nhiên khi đặt, tính theo phần của 1 ô (0 = thẳng hàng)', range: [0, 0.4, 0.01] })
    public placeJitter = 0;

    @property({ tooltip: 'Nghiêng ngẫu nhiên tối đa (độ) khi đặt (0 = không nghiêng)', range: [0, 30, 0.5] })
    public placeTilt = 0;

    /** Vị trí (local board) + góc lệch ngẫu nhiên cho 1 lần đặt — để đồ trông tự nhiên, không quá ngăn nắp. */
    public getMessyOffset(): { x: number; y: number; angle: number } {
        const r = () => Math.random() * 2 - 1;
        return {
            x: r() * this.placeJitter * this._pitchX,
            y: r() * this.placeJitter * this._pitchY,
            angle: r() * this.placeTilt,
        };
    }

    @property({ type: Color, tooltip: 'Màu viền sáng khi hộp đầy' })
    public glowColor: Color = new Color(255, 236, 120, 255);

    @property({ tooltip: 'Viền sáng phình thêm bao nhiêu lần trong lúc nháy' })
    public glowScale = 1.04;

    @property({ type: SpriteFrame, tooltip: 'Ảnh glow mềm dạng 9-slice (VD UI/glow_rect). Để trống = dùng bản sao sprite hộp.' })
    public glowFrame: SpriteFrame | null = null;

    @property({ tooltip: 'Quầng sáng lan ra ngoài viền hộp bao nhiêu (local của hộp)', visible(this: GridBoard) { return !!this.glowFrame; } })
    public glowMargin = 120;

    private _glow: Node | null = null;
    private _glowK = 1;

    private _grid: Node[][] = [];            // [row][col]
    private _baseColors: Color[][] = [];
    private _occ: (IGridOccupant | null)[][] = [];
    private _origin = v3();                  // tâm ô (0,0), local của board
    private _pitchX = 100;
    private _pitchY = 100;
    private _highlighted: GridCellCoord[] = [];
    private _built = false;

    protected onLoad() {
        this.build();
    }

    /** Dựng lại dữ liệu lưới từ các node ô. Gọi lại được nếu đổi layout lúc runtime. */
    public build() {
        const nodes = (this.cells && this.cells.length > 0)
            ? this.cells.filter(n => !!n)
            : this.node.children.filter(n => n.name.startsWith(this.cellNamePrefix));

        const need = this.cols * this.rows;
        if (nodes.length !== need) {
            console.warn(`[GridBoard] ${this.node.name}: có ${nodes.length} ô nhưng cols*rows = ${need}.`);
        }

        // Sắp theo hàng (y giảm dần) rồi theo cột (x tăng dần).
        const sorted = nodes.slice().sort((a, b) => {
            const dy = b.position.y - a.position.y;
            if (Math.abs(dy) > 1) return dy;
            return a.position.x - b.position.x;
        });

        this._grid = [];
        this._baseColors = [];
        this._occ = [];
        for (let r = 0; r < this.rows; r++) {
            const rowNodes: Node[] = [];
            const rowColors: Color[] = [];
            const rowOcc: (IGridOccupant | null)[] = [];
            for (let c = 0; c < this.cols; c++) {
                const n = sorted[r * this.cols + c] || null;
                rowNodes.push(n!);
                const sp = n?.getComponent(Sprite);
                rowColors.push(sp ? sp.color.clone() : Color.WHITE.clone());
                rowOcc.push(null);
            }
            this._grid.push(rowNodes);
            this._baseColors.push(rowColors);
            this._occ.push(rowOcc);
        }

        const c00 = this._grid[0]?.[0];
        if (c00) this._origin.set(c00.position.x, c00.position.y, 0);
        const c10 = this.cols > 1 ? this._grid[0][1] : null;
        const c01 = this.rows > 1 ? this._grid[1]?.[0] : null;
        const cellUT = c00?.getComponent(UITransform);
        const fallback = cellUT ? cellUT.width * c00!.scale.x : 100;
        this._pitchX = c10 && c00 ? Math.abs(c10.position.x - c00.position.x) : fallback;
        this._pitchY = c01 && c00 ? Math.abs(c00.position.y - c01.position.y) : fallback;

        if (!this.piecesRoot) {
            let root = this.node.getChildByName('Pieces');
            if (!root) {
                root = new Node('Pieces');
                root.layer = this.node.layer;
                root.addComponent(UITransform);
                this.node.addChild(root);
            }
            this.piecesRoot = root;
        }
        this.piecesRoot.setSiblingIndex(this.node.children.length - 1);
        let sr = this.node.getChildByName('Shadows');
        if (!sr) {
            sr = new Node('Shadows');
            sr.layer = this.node.layer;
            sr.addComponent(UITransform);
            this.node.addChild(sr);
        }
        sr.setPosition(this.piecesRoot.position);
        sr.setScale(this.piecesRoot.scale);
        sr.setSiblingIndex(this.piecesRoot.getSiblingIndex()); // ngay trước Pieces
        this.shadowsRoot = sr;
        if (this.cover) {
            this._coverPos.set(this.cover.position);
            this._coverScale.set(this.cover.scale);
            this.cover.setSiblingIndex(this.node.children.length - 1); // nắp vẽ trên đồ
            if (!EDITOR) this.cover.active = false;
        }
        this._built = true;
    }

    /**
     * Sắp lại thứ tự vẽ các piece trên lưới theo GridPiece.boardLayer (VD hộp con trên food).
     * Cùng lớp thì giữ nguyên thứ tự hiện tại (món đặt sau vẫn đè món đặt trước).
     */
    public sortPieces() {
        const root = this.piecesRoot;
        if (!root) return;
        const layerOf = (n: Node) => (n.getComponent('GridPiece') as any)?.boardLayer ?? 0;
        const kids = root.children.slice();
        const sorted = kids
            .map((n, i) => ({ n, i, l: layerOf(n) }))
            .sort((a, b) => (a.l - b.l) || (a.i - b.i));
        sorted.forEach((x, idx) => { if (x.n.getSiblingIndex() !== idx) x.n.setSiblingIndex(idx); });
    }

    /** Ẩn / hiện các ô lưới (mờ dần). */
    public setCellsVisible(visible: boolean, duration = 0.3) {
        for (const row of this._grid) {
            for (const n of row) {
                if (!n) continue;
                const op = n.getComponent(UIOpacity) || n.addComponent(UIOpacity);
                Tween.stopAllByTarget(op);
                tween(op).to(duration, { opacity: visible ? 255 : 0 }).start();
            }
        }
    }

    private readonly _coverPos = v3();
    private readonly _coverScale = v3(1, 1, 1);

    /**
     * Hộp vừa đầy: viền sáng lên (glow sau hộp) + các món bên trong lần lượt nảy lên như sóng (chéo từ góc trái-trên).
     * Trả về thời gian hiệu ứng (giây).
     */
    public playFullFx(delay = 0): number {
        // ---- Glow: bản sao sprite hộp, tô màu, to hơn, nằm ngay SAU hộp
        const src = this.getComponent(Sprite);
        if (src && src.spriteFrame && this.node.parent) {
            if (!this._glow || !this._glow.isValid) {
                const g = new Node(this.node.name + '_Glow');
                g.layer = this.node.layer;
                const ut = g.addComponent(UITransform);
                const boxSize = this.node.getComponent(UITransform)!.contentSize;
                const sp = g.addComponent(Sprite);
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                if (this.glowFrame) {
                    // Quầng sáng mềm: 9-slice phủ hộp + lan ra ngoài glowMargin
                    sp.type = Sprite.Type.SLICED;
                    sp.spriteFrame = this.glowFrame;
                    ut.setContentSize(boxSize.width + this.glowMargin * 2, boxSize.height + this.glowMargin * 2);
                } else {
                    sp.spriteFrame = src.spriteFrame;
                    ut.setContentSize(boxSize);
                }
                sp.color = this.glowColor;
                g.addComponent(UIOpacity).opacity = 0;
                this.node.parent.insertChild(g, this.node.getSiblingIndex());
                this._glow = g;
            }
            const g = this._glow;
            g.active = true;
            const op = g.getComponent(UIOpacity)!;
            Tween.stopAllByTarget(op);
            op.opacity = 0;
            tween(op).delay(delay)
                .to(0.15, { opacity: 255 }).to(0.2, { opacity: 110 })
                .to(0.15, { opacity: 255 }).to(0.45, { opacity: 0 })
                .call(() => { g.active = false; })
                .start();
            const gk = { k: 1 };
            this._glowK = 1;
            tween(gk).delay(delay).to(0.95, { k: this.glowScale }, { easing: 'sineOut', onUpdate: () => { this._glowK = gk.k; } }).start();
        }

        // ---- Sóng: món theo đường chéo (row + col) nảy lên lần lượt
        const items = this.getOccupants()
            .map(o => ({ o, node: (o as any).node as Node, cell: this.findCell(o) }))
            .filter(x => x.node && x.node.isValid)
            .sort((a, b) => (a.cell.row + a.cell.col) - (b.cell.row + b.cell.col));
        const step = 0.07;
        const lift = this._pitchY * 0.22;
        items.forEach((x, i) => {
            const n = x.node;
            const d = delay + 0.1 + (x.cell.row + x.cell.col) * step;
            const holder = { k: 0 };
            let basePos: Vec3 | null = null;
            let baseScale: Vec3 | null = null;
            const homeParent = n.parent;
            const stillHere = () => n.isValid && n.parent === homeParent;
            tween(holder).delay(d)
                .call(() => { if (stillHere()) { basePos = n.position.clone(); baseScale = n.scale.clone(); } })
                .to(0.32, { k: 1 }, {
                    onUpdate: () => {
                        if (!basePos || !baseScale || !stillHere()) return;
                        const h = Math.sin(holder.k * Math.PI);
                        n.setPosition(basePos.x, basePos.y + lift * h, basePos.z);
                        const sc = 1 + 0.12 * h;
                        n.setScale(baseScale.x * sc, baseScale.y * sc, baseScale.z);
                    },
                })
                .call(() => { if (basePos && baseScale && stillHere()) { n.setPosition(basePos); n.setScale(baseScale); } })
                .start();
        });
        const maxDiag = items.reduce((m, x) => Math.max(m, x.cell.row + x.cell.col), 0);
        return delay + 0.1 + maxDiag * step + 0.32;
    }

    private findCell(o: IGridOccupant): GridCellCoord {
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this._occ[r][c] === o) return { col: c, row: r };
        return { col: 0, row: 0 };
    }

    protected update() {
        const g = this._glow;
        if (!g || !g.active) return;
        g.setPosition(this.node.position);
        const s = this.node.scale;
        g.setScale(s.x * this._glowK, s.y * this._glowK, s.z);
        g.angle = this.node.angle;
        if (g.getSiblingIndex() !== this.node.getSiblingIndex() - 1) {
            const idx = this.node.getSiblingIndex(), gi = g.getSiblingIndex();
            g.setSiblingIndex(gi < idx ? idx - 1 : idx);
        }
    }

    /** Nắp rơi từ trên xuống, rõ dần rồi đậy khít hộp. onDone gọi khi nắp chạm hộp. */
    public closeCover(duration = 0.5, onDone?: () => void) {
        const cover = this.cover;
        if (!cover) { onDone?.(); return; }
        const op = cover.getComponent(UIOpacity) || cover.addComponent(UIOpacity);
        cover.active = true;
        cover.setSiblingIndex(this.node.children.length - 1);
        Tween.stopAllByTarget(cover);
        Tween.stopAllByTarget(op);
        const p = this._coverPos, s = this._coverScale;
        cover.setPosition(p.x, p.y + this.coverDropHeight, p.z);
        cover.setScale(s.x * 1.12, s.y * 1.12, s.z);
        op.opacity = 0;
        tween(op).to(duration * 0.8, { opacity: 255 }, { easing: 'quadOut' }).start();
        tween(cover)
            .to(duration, { position: p, scale: s }, { easing: 'quadIn' })
            .call(() => onDone?.())
            .to(0.07, { scale: v3(s.x * 1.04, s.y * 0.96, s.z) })
            .to(0.12, { scale: s }, { easing: 'backOut' })
            .start();
    }

    // ---------------------------------------------------------------- Kích thước

    /** Khoảng cách tâm-tâm giữa 2 ô, theo toạ độ local của board. */
    public get pitchX() { return this._pitchX; }
    public get pitchY() { return this._pitchY; }

    /** Khoảng cách tâm-tâm giữa 2 ô theo toạ độ world. */
    public getWorldPitch(out = v3()): Vec3 {
        const s = this.node.worldScale;
        return out.set(this._pitchX * Math.abs(s.x), this._pitchY * Math.abs(s.y), 1);
    }

    /** Tâm vùng w x h có góc trái-trên ở (col,row), local của board. */
    public getAreaCenterLocal(col: number, row: number, w: number, h: number, out = v3()): Vec3 {
        return out.set(
            this._origin.x + (col + (w - 1) / 2) * this._pitchX,
            this._origin.y - (row + (h - 1) / 2) * this._pitchY,
            0,
        );
    }

    public getAreaCenterWorld(col: number, row: number, w: number, h: number, out = v3()): Vec3 {
        this.getAreaCenterLocal(col, row, w, h, out);
        const ut = this.node.getComponent(UITransform)!;
        return ut.convertToWorldSpaceAR(out, out);
    }

    // ---------------------------------------------------------------- Truy vấn

    public inBounds(col: number, row: number, w = 1, h = 1) {
        return col >= 0 && row >= 0 && col + w <= this.cols && row + h <= this.rows;
    }

    public getOccupant(col: number, row: number): IGridOccupant | null {
        if (!this.inBounds(col, row)) return null;
        return this._occ[row][col];
    }

    public canPlace(col: number, row: number, w: number, h: number, ignore: IGridOccupant | null = null): boolean {
        if (!this.inBounds(col, row, w, h)) return false;
        for (let r = row; r < row + h; r++) {
            for (let c = col; c < col + w; c++) {
                const o = this._occ[r][c];
                if (o && o !== ignore) return false;
            }
        }
        return true;
    }

    /**
     * Ô góc trái-trên gần nhất nếu đặt 1 vật w x h có TÂM tại worldPos.
     * Trả null nếu tâm vật nằm ngoài vùng lưới (nới thêm `margin` ô mỗi cạnh).
     * Không kiểm tra ô trống — dùng canPlace sau đó.
     */
    public getAnchorFromWorld(worldPos: Vec3, w: number, h: number, margin = 0.5): GridCellCoord | null {
        const ut = this.node.getComponent(UITransform);
        if (!ut) return null;
        const p = ut.convertToNodeSpaceAR(v3(worldPos.x, worldPos.y, 0));
        const fx = (p.x - this._origin.x) / this._pitchX; // toạ độ ô (số thực) của tâm vật
        const fy = (this._origin.y - p.y) / this._pitchY;
        if (fx < -0.5 - margin || fx > this.cols - 0.5 + margin) return null;
        if (fy < -0.5 - margin || fy > this.rows - 0.5 + margin) return null;
        const col = Math.round(fx - (w - 1) / 2);
        const row = Math.round(fy - (h - 1) / 2);
        // Vùng tràn ra ngoài lưới -> không hợp lệ (không sáng).
        if (!this.inBounds(col, row, w, h)) return null;
        return { col, row };
    }

    public freeCount(): number {
        let n = 0;
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (!this._occ[r][c]) n++;
        return n;
    }

    public isFull(): boolean {
        return this._built && this.freeCount() === 0;
    }

    public getOccupants(): IGridOccupant[] {
        const set = new Set<IGridOccupant>();
        for (const row of this._occ) for (const o of row) if (o) set.add(o);
        return Array.from(set);
    }

    // ---------------------------------------------------------------- Thay đổi

    public place(occ: IGridOccupant, col: number, row: number): boolean {
        if (!this.canPlace(col, row, occ.sizeW, occ.sizeH, occ)) return false;
        this.remove(occ, false);
        for (let r = row; r < row + occ.sizeH; r++) {
            for (let c = col; c < col + occ.sizeW; c++) this._occ[r][c] = occ;
        }
        this.node.emit(GridBoard.EVENT_CHANGED, this);
        return true;
    }

    public remove(occ: IGridOccupant, emit = true): boolean {
        let found = false;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this._occ[r][c] === occ) {
                    this._occ[r][c] = null;
                    found = true;
                }
            }
        }
        if (found && emit) this.node.emit(GridBoard.EVENT_CHANGED, this);
        return found;
    }

    public clearAll() {
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this._occ[r][c] = null;
        this.node.emit(GridBoard.EVENT_CHANGED, this);
    }

    // ---------------------------------------------------------------- Highlight

    public highlight(col: number, row: number, w: number, h: number) {
        // Bỏ qua nếu đang sáng đúng vùng này.
        if (this._highlighted.length === w * h && this._highlighted[0]?.col === col && this._highlighted[0]?.row === row) return;
        this.clearHighlight();
        for (let r = row; r < row + h; r++) {
            for (let c = col; c < col + w; c++) {
                const sp = this._grid[r]?.[c]?.getComponent(Sprite);
                if (sp) sp.color = this.highlightColor;
                this._highlighted.push({ col: c, row: r });
            }
        }
    }

    public clearHighlight() {
        for (const h of this._highlighted) {
            const sp = this._grid[h.row]?.[h.col]?.getComponent(Sprite);
            if (sp) sp.color = this._baseColors[h.row][h.col];
        }
        this._highlighted.length = 0;
    }
}
