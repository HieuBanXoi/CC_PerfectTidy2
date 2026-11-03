import { math, Node, Rect, UITransform, Vec2, Vec3 } from 'cc';
import { ItemSnap } from './ItemSnap';

/** Cấu hình vùng spawn (ItemSpawnManager cung cấp). */
export interface SpawnAreaConfig {
    /** Node có UITransform giới hạn vùng spawn. */
    readonly area: Node;
    /** Node cha chứa item sau khi spawn (để quy đổi scale). */
    readonly container: Node;
    /** Lề trong vùng spawn (local của area). */
    readonly padding: Vec2;
    /** Các vùng không được spawn (chỉ tính node đang active). */
    readonly blockAreas: readonly Node[];
    /** Bước lưới (world) khi tìm chỗ rải item. */
    readonly gridStep: number;
    /** Số lần thử random trước khi quét lưới. */
    readonly maxAttempts: number;
}

/**
 * Tính vị trí spawn trong vùng: random 1 điểm hợp lệ, hoặc rải đều nhiều item hạn chế đè nhau.
 * Không giữ state, không đụng tới gameplay; chỉ đọc kích thước item.
 */
export class SpawnAreaPlanner {
    constructor(private readonly config: SpawnAreaConfig) { }

    // ==================== RANDOM 1 ĐIỂM ====================

    /** Toạ độ local (trong area) ngẫu nhiên, nằm ngoài mọi vùng cấm. */
    public GetRandomLocalPosition(): Vec3 {
        const area = this.config.area;
        const ut = this.getTransform(area);
        const { minX, maxX, minY, maxY } = this.getLocalBounds(ut);
        const candidate = new Vec3();

        // Rejection sampling: thử random tới khi ra ngoài toàn bộ vùng cấm.
        const attempts = Math.max(1, Math.floor(this.config.maxAttempts));
        for (let i = 0; i < attempts; i++) {
            candidate.set(math.randomRange(minX, maxX), math.randomRange(minY, maxY), 0);
            if (this.isLocalPointAllowed(candidate, ut)) return candidate.clone();
        }

        // Fallback: quét lưới để tìm nhanh 1 điểm hợp lệ.
        const gridSize = 6;
        for (let gy = 0; gy < gridSize; gy++) {
            const y = minY + (maxY - minY) * gy / (gridSize - 1);
            for (let gx = 0; gx < gridSize; gx++) {
                candidate.set(minX + (maxX - minX) * gx / (gridSize - 1), y, 0);
                if (this.isLocalPointAllowed(candidate, ut)) return candidate.clone();
            }
        }

        console.warn('[SpawnAreaPlanner] Không tìm được vị trí spawn ngoài vùng cấm. Dùng vị trí ngẫu nhiên trong vùng spawn.');
        return new Vec3(math.randomRange(minX, maxX), math.randomRange(minY, maxY), 0);
    }

    /** Toạ độ world ngẫu nhiên hợp lệ trong vùng spawn. */
    public GetRandomWorldPosition(): Vec3 {
        return this.getTransform(this.config.area).convertToWorldSpaceAR(this.GetRandomLocalPosition());
    }

    /** Chia vùng theo trục X thành totalCount đoạn, lấy 1 điểm ngẫu nhiên trong đoạn index (local của area). */
    public GetDistributedLocalPosition(index: number, totalCount: number): Vec3 {
        const { minX, maxX, minY, maxY } = this.getLocalBounds(this.getTransform(this.config.area), false);
        if (totalCount <= 1) {
            return new Vec3(math.randomRange(minX, maxX), math.randomRange(minY, maxY), 0);
        }
        const stepX = (maxX - minX) / totalCount;
        const centerX = minX + stepX * (index + 0.5);
        return new Vec3(
            math.randomRange(centerX - stepX * 0.35, centerX + stepX * 0.35),
            math.randomRange(minY, maxY),
            0,
        );
    }

    // ==================== RẢI NHIỀU ITEM ====================

    /**
     * Vị trí world rải đều cho items (theo kích thước ở scale chờ và góc xoay hiện tại), hạn chế đè nhau.
     * Xếp item to trước: mỗi item thử lưới phủ cả vùng, chọn chỗ ít diện tích đè nhất (lên item đã xếp,
     * avoidRect, vùng cấm); cùng mức đè thì chọn chỗ cách xa các item khác nhất. Trả về theo đúng thứ tự items.
     */
    public PlanSpreadWorldPositions(items: readonly ItemSnap[], avoidRect: Rect | null = null): Vec3[] {
        const area = this.config.area;
        const bounds = this.getTransform(area).getBoundingBoxToWorld();
        const padX = this.config.padding.x * Math.abs(area.worldScale.x);
        const padY = this.config.padding.y * Math.abs(area.worldScale.y);
        const minX = bounds.xMin + padX, maxX = bounds.xMax - padX;
        const minY = bounds.yMin + padY, maxY = bounds.yMax - padY;
        const parentScale = this.config.container.worldScale;
        const step = Math.max(5, this.config.gridStep);
        const blocks = this.getBlockRects();

        // Khung bao (AABB world) của từng item khi đã xoay, tính quanh tâm hình (không phải anchor).
        const plans = items.map((item, index) => {
            const ut = item.getComponent(UITransform);
            const scale = item.GetWaitingScale();
            const w = (ut?.width ?? 0) * Math.abs(scale.x * parentScale.x);
            const h = (ut?.height ?? 0) * Math.abs(scale.y * parentScale.y);
            const rad = item.node.angle * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const lx = ut ? (0.5 - ut.anchorX) * w : 0, ly = ut ? (0.5 - ut.anchorY) * h : 0;
            return {
                index,
                hx: (Math.abs(cos) * w + Math.abs(sin) * h) * 0.5,
                hy: (Math.abs(sin) * w + Math.abs(cos) * h) * 0.5,
                ox: lx * cos - ly * sin,
                oy: lx * sin + ly * cos,
            };
        }).sort((a, b) => b.hx * b.hy - a.hx * a.hy);

        const placed: { cx: number; cy: number; hx: number; hy: number }[] = [];
        const result: Vec3[] = items.map(item => item.node.worldPosition.clone());
        const point = new Vec2();

        for (const plan of plans) {
            const { hx, hy } = plan;
            // Giữ cả item nằm trong vùng; item to hơn vùng thì đặt giữa.
            const x0 = Math.min(minX + hx, (minX + maxX) * 0.5), x1 = Math.max(maxX - hx, x0);
            const y0 = Math.min(minY + hy, (minY + maxY) * 0.5), y1 = Math.max(maxY - hy, y0);
            const nx = Math.max(1, Math.ceil((x1 - x0) / step)), ny = Math.max(1, Math.ceil((y1 - y0) / step));

            let bestX = (x0 + x1) * 0.5, bestY = (y0 + y1) * 0.5;
            let bestCost = Number.POSITIVE_INFINITY, bestGap = Number.NEGATIVE_INFINITY;
            for (let gy = 0; gy <= ny; gy++) {
                for (let gx = 0; gx <= nx; gx++) {
                    // Lệch ngẫu nhiên trong ô lưới để các item không thẳng hàng.
                    const cx = math.clamp(x0 + (x1 - x0) * gx / nx + math.randomRange(-0.35, 0.35) * step, x0, x1);
                    const cy = math.clamp(y0 + (y1 - y0) * gy / ny + math.randomRange(-0.35, 0.35) * step, y0, y1);

                    let cost = 0;
                    let gap = Number.POSITIVE_INFINITY;
                    for (const o of placed) {
                        cost += SpawnAreaPlanner.overlap(cx, cy, hx, hy, o.cx - o.hx, o.cy - o.hy, o.cx + o.hx, o.cy + o.hy);
                        gap = Math.min(gap, Math.max(Math.abs(cx - o.cx) - hx - o.hx, Math.abs(cy - o.cy) - hy - o.hy));
                    }
                    if (avoidRect) {
                        cost += SpawnAreaPlanner.overlap(cx, cy, hx, hy, avoidRect.xMin, avoidRect.yMin, avoidRect.xMax, avoidRect.yMax) * 4;
                    }
                    point.set(cx, cy);
                    for (const block of blocks) {
                        if (block.contains(point)) cost += 1e9;
                    }
                    // Chưa có item nào thì gap = 0 ở mọi chỗ: chọn ngẫu nhiên.
                    const gapScore = (Number.isFinite(gap) ? gap : 0) + Math.random() * step * 0.5;

                    if (cost < bestCost - 1 || (cost <= bestCost + 1 && gapScore > bestGap)) {
                        bestCost = cost;
                        bestGap = gapScore;
                        bestX = cx;
                        bestY = cy;
                    }
                }
            }

            placed.push({ cx: bestX, cy: bestY, hx, hy });
            result[plan.index] = new Vec3(bestX - plan.ox, bestY - plan.oy, 0);
        }
        return result;
    }

    // ==================== GIỮ TRỐNG 1 HOLDER ====================

    /** Khung world của node nới rộng margin (null nếu node không hợp lệ / không hiển thị). */
    public static GetExpandedRect(node: Node | null, margin: number): Rect | null {
        const ut = node?.isValid && node.activeInHierarchy ? node.getComponent(UITransform) : null;
        if (!ut) return null;
        const rect = ut.getBoundingBoxToWorld();
        rect.x -= margin;
        rect.y -= margin;
        rect.width += margin * 2;
        rect.height += margin * 2;
        return rect;
    }

    /** Dời các item đang đè lên rect sang vị trí random khác (để chỗ đặt hand tut chỉ tới không bị che). */
    public MoveItemsOffRect(items: readonly ItemSnap[], rect: Rect): void {
        const attempts = Math.max(1, Math.floor(this.config.maxAttempts));
        for (const item of items) {
            let moved = false;
            for (let i = 0; i < attempts && SpawnAreaPlanner.isItemOverlappingRect(item, rect); i++) {
                item.node.setPosition(this.GetRandomLocalPosition());
                moved = true;
            }
            if (moved) item.waitingPosition = item.node.worldPosition.clone();
        }
    }

    // ==================== HELPERS ====================

    /** So theo vòng tròn cỡ trung bình của item ở scale chờ (chỉ né vừa đủ, không đẩy item ra quá xa). */
    private static isItemOverlappingRect(item: ItemSnap, rect: Rect): boolean {
        const ut = item.getComponent(UITransform);
        if (!ut) return false;
        const parentScale = Math.abs(item.node.parent?.worldScale.x ?? 1);
        const radius = (ut.width + ut.height) * 0.25 * Math.abs(item.GetWaitingScale().x) * parentScale;
        if (radius <= 0) return false;
        const center = item.node.worldPosition;
        const dx = center.x - math.clamp(center.x, rect.xMin, rect.xMax);
        const dy = center.y - math.clamp(center.y, rect.yMin, rect.yMax);
        return dx * dx + dy * dy < radius * radius;
    }

    private static overlap(cx: number, cy: number, hx: number, hy: number, xMin: number, yMin: number, xMax: number, yMax: number): number {
        return Math.max(0, Math.min(cx + hx, xMax) - Math.max(cx - hx, xMin))
            * Math.max(0, Math.min(cy + hy, yMax) - Math.max(cy - hy, yMin));
    }

    private getTransform(node: Node): UITransform {
        return node.getComponent(UITransform) || node.addComponent(UITransform);
    }

    /** Biên local của area trừ lề. safe = true: lề lớn hơn vùng thì bỏ lề. */
    private getLocalBounds(ut: UITransform, safe: boolean = true): { minX: number; maxX: number; minY: number; maxY: number } {
        const width = ut.width || 400;
        const height = ut.height || 200;
        const pad = this.config.padding;
        let minX = -ut.anchorX * width + pad.x, maxX = (1 - ut.anchorX) * width - pad.x;
        let minY = -ut.anchorY * height + pad.y, maxY = (1 - ut.anchorY) * height - pad.y;
        if (safe && minX >= maxX) { minX = -width * 0.5; maxX = width * 0.5; }
        if (safe && minY >= maxY) { minY = -height * 0.5; maxY = height * 0.5; }
        return { minX, maxX, minY, maxY };
    }

    private getBlockRects(): Rect[] {
        return this.config.blockAreas
            .filter(node => node?.isValid && node.activeInHierarchy && node.getComponent(UITransform))
            .map(node => node.getComponent(UITransform)!.getBoundingBoxToWorld());
    }

    private isLocalPointAllowed(localPos: Vec3, areaUT: UITransform): boolean {
        const blocks = this.getBlockRects();
        if (blocks.length === 0) return true;
        const world = areaUT.convertToWorldSpaceAR(localPos);
        const point = new Vec2(world.x, world.y);
        return !blocks.some(rect => rect.contains(point));
    }
}
