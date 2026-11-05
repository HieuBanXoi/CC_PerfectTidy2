import { _decorator, Canvas, Color, Component, EventTouch, instantiate, Node, ParticleSystem2D, Prefab, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec2, Vec3, v3 } from 'cc';
import { GridBoard, GridCellCoord } from './GridBoard';
import { GridPiece } from './GridPiece';
import { PackContainer } from './PackContainer';
import { GameManager } from '../Systems/GameManager';
import { HandHintRequest, HandHintSource, IdleHandHint } from '../Systems/IdleHandHint';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
const { ccclass, property } = _decorator;

type DropTarget =
    | { kind: 'container'; container: PackContainer }
    | { kind: 'board'; board: GridBoard; cell: GridCellCoord; evict: GridPiece[] }
    | null;

type Origin =
    | { kind: 'board'; board: GridBoard; col: number; row: number }
    | { kind: 'container'; container: PackContainer }
    | { kind: 'floor' };

/**
 * GRID PACK MANAGER — controller kéo thả cho GridBoard / GridPiece / PackContainer.
 * -------------------------------------------------------------
 * - Kéo item/hộp: ô lưới dưới chân sáng xanh nếu vùng nằm trọn trong lưới. Đè lên đồ khác -> đồ bị đè bật ra sàn
 *   (đồ sắp bị đè nhấp nháy đỏ khi đang kéo qua).
 * - Item kéo vào hộp con đang mở (cùng loại, đúng size) -> xếp chồng; đủ capacity -> hộp đóng nắp.
 * - Hộp con chỉ kéo được khi đã đóng.
 * - Thả ra ngoài: nằm lại sàn (nếu trong floorArea) hoặc bay về chỗ cũ trên sàn.
 * - Mọi board đầy và không còn đồ trên sàn -> GameManager.WinGame().
 * - Là 1 HandHintSource cho IdleHandHint (tay gợi ý).
 */
@ccclass('GridPackManager')
export class GridPackManager extends Component implements HandHintSource {
    public static Ins: GridPackManager | null = null;
    private static readonly HINT_PRIORITY = 0;

    @property({ type: [GridBoard], tooltip: 'Các Main Box (lưới cần lấp đầy)' })
    public boards: GridBoard[] = [];

    @property({ type: [Node], tooltip: 'Các node chứa piece trên sàn (item, hộp con). Tự gom GridPiece trong đó.' })
    public pieceRoots: Node[] = [];

    @property({ type: Node, tooltip: 'Layer vẽ trên cùng khi đang kéo' })
    public dragLayer: Node | null = null;

    @property({ type: Node, tooltip: 'Vùng sàn: thả trong vùng này thì đồ nằm lại chỗ thả. Để trống = luôn bay về chỗ cũ.' })
    public floorArea: Node | null = null;

    @property({ tooltip: 'Phóng to thêm khi nhấc lên' })
    public pickScale = 1.1;

    @property({ tooltip: 'Hộp con: ngón tay di chuyển quá bao nhiêu px (world) thì tính là kéo, ít hơn = chạm (mở/đóng nắp)' })
    public tapSlop = 15;

    @property({ tooltip: 'Nâng vật lên trên ngón tay (px world) để không bị ngón che' })
    public dragLiftY = 40;

    @property({ type: Color, tooltip: 'Màu nhấp nháy của đồ sắp bị đè' })
    public evictTint: Color = new Color(255, 110, 110, 255);

    @property({ type: Prefab, tooltip: 'Hiệu ứng khi đặt vào lưới / hộp đóng (tuỳ chọn)' })
    public placeFx: Prefab | null = null;

    @property({ tooltip: 'Đồ xuất hiện lần lượt lúc bắt đầu' })
    public introPop = true;

    @property({ type: SpriteFrame, tooltip: 'Túi đi chợ: đồ ăn đổ ra từ túi lúc bắt đầu. Để trống = đồ chỉ bật ra tại chỗ.' })
    public introBagFrame: SpriteFrame | null = null;

    @property({ tooltip: 'Vị trí túi (local trong node chứa đồ trên sàn)', visible(this: GridPackManager) { return !!this.introBagFrame; } })
    public introBagPos: Vec2 = new Vec2(0, -560);

    @property({ tooltip: 'Chiều cao túi (px world)', visible(this: GridPackManager) { return !!this.introBagFrame; } })
    public introBagHeight = 320;

    @property({ tooltip: 'Khoảng cách giữa 2 món đổ ra (giây)', visible(this: GridPackManager) { return !!this.introBagFrame; } })
    public introSpillInterval = 0.05;

    @property({ tooltip: 'Chờ bao lâu sau khi xếp xong món cuối mới bắt đầu chuỗi thắng (đủ để sóng nảy của hộp chạy xong)' })
    public winStartDelay = 1.0;

    @property({ tooltip: 'Thời gian nắp Main Box rơi xuống đậy hộp' })
    public coverDropDuration = 0.55;

    @property({ tooltip: 'Thời gian các Main Box trượt xuống giữa màn hình' })
    public winMoveDuration = 0.6;

    @property({ tooltip: 'Lệch thêm so với tâm màn hình khi hộp dồn vào giữa' })
    public winCenterOffset: Vec2 = new Vec2(0, 0);

    @property({ tooltip: 'Phóng to Main Box khi dồn vào giữa' })
    public winBoxScale = 1.0;

    @property({ type: Prefab, tooltip: 'Blink effect spawn trên mỗi Main Box sau khi đậy nắp (VD BlinkFX.prefab)' })
    public blinkFx: Prefab | null = null;

    @property({ tooltip: 'Độ phủ của blink so với kích thước hộp (1 = vừa khít hộp)' })
    public blinkSizeScale = 1.0;

    @property({ tooltip: 'Blink chạy bao lâu rồi mới gọi WinGame' })
    public blinkDuration = 1.2;

    @property({ tooltip: 'Bật tay gợi ý (cần IdleHandHint trong scene)' })
    public enableHandHint = true;

    private _pieces: GridPiece[] = [];
    private _containers: PackContainer[] = [];
    private _drag: GridPiece | null = null;
    private _origin: Origin = { kind: 'floor' };
    private _grabOffset = v3();
    private _target: DropTarget = null;
    private _hoverContainer: PackContainer | null = null;
    private _evictShown: GridPiece[] = [];
    private _won = false;
    private _targetScale = 1;
    private _lastTouch = v3();
    private _introPlaying = false;
    private _pendingBox: { p: GridPiece; start: Vec3; moved: boolean } | null = null;

    protected onLoad() {
        GridPackManager.Ins = this;
    }

    protected onDestroy() {
        if (GridPackManager.Ins === this) GridPackManager.Ins = null;
        IdleHandHint.Unregister(this);
    }

    protected start() {
        this.collectPieces();
        if (this.enableHandHint) IdleHandHint.Register(this, GridPackManager.HINT_PRIORITY);
        if (this.introPop) this.playIntro();
    }

    // ================================================================ Setup

    public collectPieces() {
        const set = new Set<GridPiece>();
        for (const root of this.pieceRoots) {
            if (!root) continue;
            root.getComponentsInChildren(GridPiece).forEach(p => set.add(p));
        }
        this._pieces = Array.from(set);
        this._containers = this._pieces.map(p => p.getComponent(PackContainer)).filter(c => !!c) as PackContainer[];
        const refBoard = this.boards[0];
        for (const p of this._pieces) {
            p.handler = this;
            if (p.autoFloorScale && refBoard) {
                const s = p.getBoardFitWorldScale(refBoard) * p.floorScale;
                this.setWorldScale(p.node, s);
            }
            p.captureFloorHome();
        }
    }

    private playIntro() {
        const boxes = this._pieces.filter(p => !!p.getComponent(PackContainer));
        const foods = this._pieces.filter(p => !p.getComponent(PackContainer));
        // Hộp con bật ra tại chỗ
        boxes.forEach((p, i) => {
            const s = p.node.scale.clone();
            p.node.setScale(0, 0, 1);
            tween(p.node).delay(0.1 + i * 0.08).to(0.3, { scale: s }, { easing: 'backOut' }).start();
        });
        if (!this.introBagFrame || foods.length === 0) {
            foods.sort((a, b) => b.node.worldPosition.y - a.node.worldPosition.y).forEach((p, i) => {
                const s = p.node.scale.clone();
                p.node.setScale(0, 0, 1);
                tween(p.node).delay(0.15 + i * 0.04).to(0.25, { scale: s }, { easing: 'backOut' }).start();
            });
            return;
        }
        this.playBagSpill(foods);
    }

    /** Túi đi chợ rơi xuống, nghiêng, đồ ăn văng ra theo đường cong về chỗ trên sàn, rồi túi biến mất. */
    private playBagSpill(foods: GridPiece[]) {
        this._introPlaying = true;
        const floor = foods[0].floorParent || foods[0].node.parent!;
        const fs = Math.abs(floor.worldScale.x) || 1;

        // Túi (vẽ sau lưng đồ ăn)
        const bag = new Node('GroceryBag');
        bag.layer = floor.layer;
        bag.addComponent(UITransform);
        const sp = bag.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.TRIMMED;
        sp.spriteFrame = this.introBagFrame;
        floor.insertChild(bag, 0);
        const bh = bag.getComponent(UITransform)!.height || 100;
        const bs = this.introBagHeight / fs / bh;
        const bagPos = v3(this.introBagPos.x, this.introBagPos.y, 0);
        bag.setPosition(bagPos.x, bagPos.y + 1100 / fs, 0);
        bag.setScale(bs, bs, 1);
        const mouth = v3(bagPos.x - this.introBagHeight * 0.18 / fs, bagPos.y + this.introBagHeight * 0.38 / fs, 0);

        // Đồ ăn: ẩn, chờ ở miệng túi
        const order = foods.slice().sort(() => Math.random() - 0.5);
        const targets = new Map<GridPiece, { pos: Vec3; scale: Vec3; angle: number }>();
        for (const p of order) {
            targets.set(p, { pos: p.node.position.clone(), scale: p.node.scale.clone(), angle: p.node.angle });
            p.node.setPosition(mouth);
            p.node.setScale(0, 0, 1);
        }

        const dropT = 0.4, tiltT = 0.18, flyT = 0.5;
        tween(bag)
            .to(dropT, { position: bagPos }, { easing: 'bounceOut' })
            .to(tiltT, { angle: 28 }, { easing: 'quadOut' })
            .start();

        const spillStart = dropT + tiltT;
        order.forEach((p, i) => {
            const tg = targets.get(p)!;
            const t = { k: 0 };
            const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 180);
            const peak = Math.max(mouth.y, tg.pos.y) + (180 + Math.random() * 160) / fs;
            tween(t).delay(spillStart + i * this.introSpillInterval)
                .call(() => {
                    // túi giật nhẹ mỗi lần nhả 1 món
                    tween(bag).to(0.05, { scale: v3(bs * 1.06, bs * 0.95, 1) }).to(0.08, { scale: v3(bs, bs, 1) }).start();
                })
                .to(flyT, { k: 1 }, {
                    easing: 'linear',
                    onUpdate: () => {
                        const k = t.k, u = 1 - k;
                        p.node.setPosition(
                            mouth.x + (tg.pos.x - mouth.x) * k,
                            u * u * mouth.y + 2 * u * k * peak + k * k * tg.pos.y,
                            0,
                        );
                        const sc = Math.min(1, k * 2.5);
                        p.node.setScale(tg.scale.x * sc, tg.scale.y * sc, 1);
                        p.node.angle = tg.angle + spin * u;
                    },
                })
                .call(() => {
                    p.node.setPosition(tg.pos);
                    p.node.angle = tg.angle;
                    tween(p.node)
                        .to(0.06, { scale: v3(tg.scale.x * 1.12, tg.scale.y * 0.88, 1) })
                        .to(0.12, { scale: tg.scale }, { easing: 'backOut' })
                        .start();
                })
                .start();
        });

        const spillEnd = spillStart + (order.length - 1) * this.introSpillInterval + flyT;
        this.scheduleOnce(() => {
            this._introPlaying = false;
            const op = bag.addComponent(UIOpacity);
            tween(bag).to(0.15, { angle: 0 }).to(0.25, { scale: v3(0, 0, 1) }, { easing: 'backIn' }).call(() => bag.destroy()).start();
            tween(op).delay(0.15).to(0.25, { opacity: 0 }).start();
            IdleHandHint.Ins?.RestartCountdown();
        }, spillEnd + 0.1);
    }

    // ================================================================ Drag

    public onPieceTouchStart(p: GridPiece, e: EventTouch): boolean {
        if (this._won || this._drag || this._pendingBox || this._introPlaying) return false;
        if (GameManager.Ins && GameManager.Ins.isGotoStore) return false;
        // Hộp con: chờ xem là CHẠM (mở/đóng nắp) hay KÉO (chỉ khi đang đóng).
        if (p.getComponent(PackContainer)) {
            this._pendingBox = { p, start: this.touchWorld(e), moved: false };
            return true;
        }
        const holder = p.container as PackContainer | null;
        if (holder && holder.isClosed) return false;           // item trong hộp đã đóng -> nhường cho hộp
        this.beginDrag(p, e);
        return true;
    }

    private beginDrag(p: GridPiece, e: EventTouch) {
        const holder = p.container as PackContainer | null;
        // Ghi nhận chỗ cũ & gỡ khỏi chỗ cũ.
        if (p.board) {
            this._origin = { kind: 'board', board: p.board, col: p.col, row: p.row };
            p.board.remove(p);
            p.board = null;
        } else if (holder) {
            this._origin = { kind: 'container', container: holder };
            holder.removeItem(p);
        } else {
            this._origin = { kind: 'floor' };
        }

        this._drag = p;
        p.setLifted(true);
        Tween.stopAllByTarget(p.node);
        const touch = this.touchWorld(e);
        this._lastTouch.set(touch);
        p.node.setParent(this.dragLayer || this.node, true);
        this._grabOffset.set(p.node.worldPosition.x - touch.x, p.node.worldPosition.y - touch.y, 0);
        // Nâng dần lên trên ngón tay.
        tween(this._grabOffset).to(0.12, { y: Math.max(this._grabOffset.y, this.dragLiftY) }).start();
        this._targetScale = this.floorScaleOf(p) * this.pickScale;
        tween(p.node).to(0.1, { angle: p.baseAngle }).start();
        Ply_SoundManager.Ins?.PlayFx(FxType.Click);
        GameManager.Ins?.TurnOffTut?.();
        this.updateDrag(touch);
    }

    public onPieceTouchMove(p: GridPiece, e: EventTouch) {
        const pb = this._pendingBox;
        if (pb && pb.p === p) {
            if (pb.moved) return;
            const t = this.touchWorld(e);
            if (Vec3.distance(t, pb.start) <= this.tapSlop) return;
            pb.moved = true;
            const box = p.getComponent(PackContainer)!;
            if (box.isClosed) {           // hộp đóng -> kéo được
                this._pendingBox = null;
                this.beginDrag(p, e);
            }
            return;
        }
        if (this._drag !== p) return;
        const touch = this.touchWorld(e);
        this._lastTouch.set(touch);
        this.updateDrag(touch);
    }

    public onPieceTouchEnd(p: GridPiece, e: EventTouch) {
        const pb = this._pendingBox;
        if (pb && pb.p === p) {
            this._pendingBox = null;
            if (!pb.moved) {              // chạm -> mở / đóng nắp
                if (p.board) {            // đã nằm trên Main Box -> không mở được, rung nhẹ báo hiệu
                    this.shake(p.node);
                    return;
                }
                p.getComponent(PackContainer)!.toggle();
                Ply_SoundManager.Ins?.PlayFx(FxType.Click);
                GameManager.Ins?.TurnOffTut?.();
                IdleHandHint.Ins?.RestartCountdown();
            }
            return;
        }
        if (this._drag !== p) return;
        const touch = this.touchWorld(e);
        this.updateDrag(touch);
        const target = this._target;
        this.clearFeedback();
        this.setOpacity(p.node, 255);
        this._drag = null;
        p.setLifted(false);
        Tween.stopAllByTarget(this._grabOffset);

        if (target?.kind === 'container') {
            this.dropIntoContainer(p, target.container);
        } else if (target?.kind === 'board') {
            this.dropOnBoard(p, target.board, target.cell, target.evict);
        } else {
            this.dropOnFloor(p, touch);
        }
        this._target = null;
    }

    protected update(dt: number) {
        const p = this._drag;
        if (!p) return;
        // Bám theo ngón (grabOffset có tween) + scale mượt.
        this.followTouch(p, this._lastTouch);
        const cur = p.node.worldScale.x;
        const next = cur + (this._targetScale - cur) * Math.min(1, dt * 14);
        this.setWorldScale(p.node, next);
    }

    private followTouch(p: GridPiece, touch: Vec3) {
        const parentUT = p.node.parent!.getComponent(UITransform);
        const world = v3(touch.x + this._grabOffset.x, touch.y + this._grabOffset.y, 0);
        if (parentUT) p.node.setPosition(parentUT.convertToNodeSpaceAR(world));
        else p.node.setWorldPosition(world);
    }

    private updateDrag(touch: Vec3) {
        const p = this._drag!;
        this.followTouch(p, touch);
        const target = this.findTarget(p, touch);
        this._target = target;

        // Highlight ô
        for (const b of this.boards) {
            if (target?.kind === 'board' && target.board === b) b.highlight(target.cell.col, target.cell.row, p.sizeW, p.sizeH);
            else b.clearHighlight();
        }
        // Hộp đang được nhắm
        const hc = target?.kind === 'container' ? target.container : null;
        if (hc !== this._hoverContainer) {
            if (this._hoverContainer) this.setHover(this._hoverContainer, false);
            if (hc) this.setHover(hc, true);
            this._hoverContainer = hc;
        }
        // Đồ sắp bị đè
        const evict = target?.kind === 'board' ? target.evict : [];
        for (const old of this._evictShown) if (evict.indexOf(old) < 0) this.setEvictWarn(old, false);
        for (const n of evict) if (this._evictShown.indexOf(n) < 0) this.setEvictWarn(n, true);
        this._evictShown = evict.slice();
        // Đang đè lên đồ khác -> vật đang kéo hơi trong suốt để thấy đồ bên dưới.
        this.setOpacity(p.node, evict.length > 0 ? 170 : 255);

        // Scale: trên lưới -> to bằng ô, ngoài -> scale sàn
        this._targetScale = target?.kind === 'board'
            ? p.getBoardFitWorldScale(target.board) * target.board.placeScale
            : this.floorScaleOf(p) * this.pickScale;
    }

    private findTarget(p: GridPiece, touch: Vec3): DropTarget {
        const isBox = !!p.getComponent(PackContainer);
        // 1) Hộp con dưới ngón tay
        if (!isBox) {
            for (const c of this._containers) {
                if (!c.node.activeInHierarchy || !c.canAccept(p)) continue;
                const main = c.node.getChildByName('Main') || c.node;
                const rect = main.getComponent(UITransform)?.getBoundingBoxToWorld();
                if (rect && rect.contains(new Vec2(touch.x, touch.y))) {
                    return { kind: 'container', container: c };
                }
            }
        }
        // 2) Lưới — dùng tâm vật
        const center = p.node.worldPosition;
        let best: DropTarget = null;
        let bestDist = Infinity;
        for (const b of this.boards) {
            const cell = b.getAnchorFromWorld(center, p.sizeW, p.sizeH, 0.35);
            if (!cell) continue;
            const c = b.getAreaCenterWorld(cell.col, cell.row, p.sizeW, p.sizeH);
            const d = Vec3.squaredDistance(c, center);
            if (d < bestDist) {
                bestDist = d;
                const evict: GridPiece[] = [];
                for (let r = cell.row; r < cell.row + p.sizeH; r++) {
                    for (let cc = cell.col; cc < cell.col + p.sizeW; cc++) {
                        const o = b.getOccupant(cc, r) as GridPiece | null;
                        if (o && o !== p && evict.indexOf(o) < 0) evict.push(o);
                    }
                }
                best = { kind: 'board', board: b, cell, evict };
            }
        }
        return best;
    }

    // ================================================================ Drop

    private dropIntoContainer(p: GridPiece, c: PackContainer) {
        const willClose = c.count + 1 >= c.capacity;
        c.add(p);
        this.scheduleOnce(() => Ply_SoundManager.Ins?.PlayFx(FxType.PlaceItem), PackContainer.SWALLOW_TIME);
        if (willClose) {
            this.scheduleOnce(() => {
                Ply_SoundManager.Ins?.PlayFx(FxType.Complete);
                this.spawnFx(c.node.worldPosition);
            }, PackContainer.SWALLOW_TIME + 0.15 + c.closeDuration);
        }
        this.afterChange();
    }

    private dropOnBoard(p: GridPiece, board: GridBoard, cell: GridCellCoord, evict: GridPiece[]) {
        // Đồ bị đè bật ra ngoài
        for (const o of evict) {
            board.remove(o);
            o.board = null;
            this.sendToFloorHome(o, true);
        }
        board.place(p, cell.col, cell.row);
        p.board = board;
        p.col = cell.col;
        p.row = cell.row;
        p.container = null;
        p.node.setParent(board.piecesRoot!, true);
        const pos = board.getAreaCenterLocal(cell.col, cell.row, p.sizeW, p.sizeH);
        // Không quá ngăn nắp: to hơn ô một chút, lệch + nghiêng ngẫu nhiên, món đặt sau đè lên món trước.
        const messy = board.getMessyOffset();
        pos.x += messy.x;
        pos.y += messy.y;
        p.node.setSiblingIndex(board.piecesRoot!.children.length - 1);
        board.sortPieces(); // hộp con luôn trên food
        const s = p.getBoardFitWorldScale(board) * board.placeScale / Math.abs(board.piecesRoot!.worldScale.x);
        Tween.stopAllByTarget(p.node);
        tween(p.node)
            .to(0.1, { position: pos, scale: v3(s, s, 1), angle: p.baseAngle + messy.angle }, { easing: 'quadOut' })
            .to(0.07, { scale: v3(s * 1.1, s * 0.9, 1) })
            .to(0.12, { scale: v3(s, s, 1) }, { easing: 'backOut' })
            .start();
        Ply_SoundManager.Ins?.PlayFx(p.getComponent(PackContainer) ? FxType.PlaceHeavy : FxType.PlaceItem);
        GameManager.Ins?.OnItemPlaced?.(p);

        if (board.isFull()) {
            this.scheduleOnce(() => {
                if (!board.isFull()) return; // người chơi vừa lấy 1 món ra
                board.playFullFx();
                if (this._won) return; // chuỗi thắng tự lo phần còn lại
                this.spawnFx(board.node.worldPosition);
                if (!this.checkWinCondition()) Ply_SoundManager.Ins?.PlayFx(FxType.Aha);
            }, 0.25);
        }
        this.afterChange();
    }

    private dropOnFloor(p: GridPiece, touch: Vec3) {
        const area = this.floorArea?.getComponent(UITransform)?.getBoundingBoxToWorld();
        const center = p.node.worldPosition;
        const inArea = !!area && area.contains(new Vec2(center.x, center.y));
        const o = this._origin;
        if (inArea) {
            // Nằm lại chỗ thả
            p.node.setParent(p.floorParent!, true);
            this.bringToFloorTop(p, p.floorParent!);
            const s = this.floorScaleOf(p) / Math.abs(p.floorParent!.worldScale.x);
            Tween.stopAllByTarget(p.node);
            tween(p.node).to(0.15, { scale: v3(s, s, 1) }, { easing: 'backOut' }).start();
            p.floorPos.set(p.node.position);
            Ply_SoundManager.Ins?.PlayFx(FxType.PlaceLight);
        } else if (o.kind === 'board' && o.board.canPlace(o.col, o.row, p.sizeW, p.sizeH, p)) {
            this.dropOnBoard(p, o.board, { col: o.col, row: o.row }, []);
            return;
        } else if (o.kind === 'container' && o.container.canAccept(p)) {
            o.container.add(p);
        } else {
            this.sendToFloorHome(p, false);
            Ply_SoundManager.Ins?.PlayFx(FxType.Failed);
        }
        this.afterChange();
    }

    /** Bay về chỗ trên sàn. hop = nảy vòng cung (khi bị đè bật ra). */
    private sendToFloorHome(p: GridPiece, hop: boolean) {
        p.board = null;
        p.container = null;
        const parent = p.floorParent || this.node;
        p.node.setParent(parent, true);
        this.bringToFloorTop(p, parent);
        const s = this.floorScaleOf(p) / Math.abs(parent.worldScale.x);
        const start = p.node.position.clone();
        const end = p.floorPos.clone();
        Tween.stopAllByTarget(p.node);
        if (hop) {
            const peak = Math.max(start.y, end.y) + 160;
            const t = { k: 0 };
            const s0 = p.node.scale.x;
            tween(t)
                .to(0.45, { k: 1 }, {
                    easing: 'linear',
                    onUpdate: () => {
                        const k = t.k;
                        const x = start.x + (end.x - start.x) * k;
                        const y = (1 - k) * (1 - k) * start.y + 2 * (1 - k) * k * peak + k * k * end.y;
                        const sc = s0 + (s - s0) * k;
                        p.node.setPosition(x, y, 0);
                        p.node.setScale(sc, sc, 1);
                        p.node.angle = p.baseAngle + Math.sin(k * Math.PI) * 25;
                    },
                })
                .call(() => {
                    p.node.angle = p.baseAngle;
                    tween(p.node).to(0.06, { scale: v3(s * 1.1, s * 0.9, 1) }).to(0.1, { scale: v3(s, s, 1) }).start();
                })
                .start();
        } else {
            tween(p.node).to(0.25, { position: end, scale: v3(s, s, 1), angle: p.baseAngle }, { easing: 'quadOut' }).start();
        }
    }

    private afterChange() {
        this.checkWinCondition();
        IdleHandHint.Ins?.RestartCountdown();
    }

    // ================================================================ Win

    public isWin(): boolean {
        if (this.boards.length === 0) return false;
        if (!this.boards.every(b => b.isFull())) return false;
        // Không còn đồ trên sàn
        return this._pieces.every(p => !p.isOnFloor);
    }

    private checkWinCondition(): boolean {
        if (this._won || !this.isWin()) return false;
        this._won = true;
        IdleHandHint.Ins?.Hide();
        this.node.emit('grid-pack-win');
        this.scheduleOnce(() => this.playWinSequence(), this.winStartDelay);
        return true;
    }

    /**
     * Chuỗi thắng: nắp 2 hộp rơi xuống (rõ dần) đậy lại, ĐỒNG THỜI các hộp trượt xuống giữa màn hình
     * -> nảy + blink effect phủ kín từng hộp -> WinGame.
     */
    private playWinSequence() {
        const boards = this.boards.filter(b => !!b);
        const dur = this.winMoveDuration;

        // Tâm cụm hộp -> tâm màn hình (Canvas)
        const groupCenter = v3();
        boards.forEach(b => groupCenter.add(b.node.worldPosition));
        groupCenter.multiplyScalar(1 / Math.max(1, boards.length));
        const screenCenter = this.getScreenCenterWorld();
        const delta = v3(screenCenter.x - groupCenter.x + this.winCenterOffset.x, screenCenter.y - groupCenter.y + this.winCenterOffset.y, 0);

        boards.forEach((b, i) => {
            b.clearHighlight();
            b.setCellsVisible(false, 0.35); // xong rồi -> ẩn lưới phía sau
            Tween.stopAllByTarget(b.node);
            const parentScale = b.node.parent ? b.node.parent.worldScale : v3(1, 1, 1);
            const target = b.node.position.clone().add3f(delta.x / parentScale.x, delta.y / parentScale.y, 0);
            const base = b.node.scale.clone();
            const big = v3(base.x * this.winBoxScale, base.y * this.winBoxScale, base.z);
            tween(b.node).to(dur, { position: target, scale: big }, { easing: 'sineInOut' }).start();
            b.closeCover(this.coverDropDuration, () => Ply_SoundManager.Ins?.PlayFx(FxType.PlaceHeavy));
        });

        const landed = Math.max(dur, this.coverDropDuration);
        this.scheduleOnce(() => {
            Ply_SoundManager.Ins?.PlayFx(FxType.Complete);
            boards.forEach(b => {
                const s = b.node.scale.clone();
                tween(b.node)
                    .to(0.1, { scale: v3(s.x * 1.06, s.y * 1.06, s.z) })
                    .to(0.18, { scale: s }, { easing: 'backOut' })
                    .start();
                this.spawnBlink(b.node);
            });
        }, landed + 0.1);

        this.scheduleOnce(() => GameManager.Ins?.WinGame(), landed + 0.1 + this.blinkDuration);
    }

    /** Blink effect phủ kín node (chỉnh vùng phát + cỡ hạt theo kích thước hộp). */
    private spawnBlink(target: Node) {
        if (!this.blinkFx) return;
        const ut = target.getComponent(UITransform);
        const ws = target.worldScale;
        const w = ut ? ut.width * Math.abs(ws.x) : 400;
        const h = ut ? ut.height * Math.abs(ws.y) : 400;
        const fx = instantiate(this.blinkFx);
        const parent = this.dragLayer || this.node;
        parent.addChild(fx);
        this.setLayerRecursive(fx, parent.layer);
        fx.setWorldPosition(target.worldPosition);
        fx.setScale(1, 1, 1);
        const k = this.blinkSizeScale;
        for (const ps of fx.getComponentsInChildren(ParticleSystem2D)) {
            ps.posVar = new Vec2(w * 0.5 * k, h * 0.5 * k);
            const size = Math.min(w, h) * 0.16 * k;
            ps.startSize = size;
            ps.startSizeVar = size * 0.6;
            ps.totalParticles = Math.max(ps.totalParticles, 120);
            ps.emissionRate = Math.max(ps.emissionRate, 45);
            ps.resetSystem();
        }
        this.scheduleOnce(() => {
            if (!fx.isValid) return;
            fx.getComponentsInChildren(ParticleSystem2D).forEach(p => p.stopSystem());
        }, this.blinkDuration);
        this.scheduleOnce(() => fx.isValid && fx.destroy(), this.blinkDuration + 1.5);
    }

    private setLayerRecursive(n: Node, layer: number) {
        n.layer = layer;
        n.children.forEach(c => this.setLayerRecursive(c, layer));
    }

    private getScreenCenterWorld(): Vec3 {
        let n: Node | null = this.node;
        while (n && !n.getComponent(Canvas)) n = n.parent;
        return n ? n.worldPosition.clone() : v3();
    }

    // ================================================================ Hand hint

    public GetHandHint(): HandHintRequest | null {
        if (this._won || this._drag || this._pendingBox || this._introPlaying) return null;
        const h = this.findHintMove();
        if (!h) return null;
        const piece = h.piece;
        const same = () => { const n = this.findHintMove(); return !!n && n.piece === piece && n.tap === h.tap; };
        if (h.tap) {
            return {
                kind: 'tap',
                target: piece.node,
                canContinue: () => !this._won && !this._drag && !this._pendingBox && same(),
            };
        }
        return {
            kind: 'move',
            getStart: () => piece.node.worldPosition,
            getEnd: h.getEnd!,
            canContinue: () => !this._won && !this._drag && piece.isOnFloor && same(),
        };
    }

    /**
     * Bước gợi ý tiếp theo:
     *  1) Hộp đang mở + trên sàn có đồ hợp -> kéo đồ vào hộp (ưu tiên hộp đang dở dang).
     *  2) Hộp mở đã đủ đồ -> chạm để đóng. Hộp đóng chưa đủ đồ mà trên sàn có đủ đồ hợp -> chạm để mở.
     *  3) Hộp đã đóng đủ đồ còn trên sàn -> kéo vào Main Box.
     *  4) Đồ lẻ -> kéo vào Main Box.
     * tap = true: gợi ý chạm vào piece (hộp).
     */
    public findHintMove(): { piece: GridPiece; getEnd: (() => Vec3) | null; tap: boolean } | null {
        const floorItems = this._pieces.filter(p => p.isOnFloor && !p.getComponent(PackContainer));
        // Số món còn trên sàn mà hộp c có thể nhận (theo loại đầu tiên đủ số lượng)
        const pickFor = (c: PackContainer, test: (p: GridPiece) => boolean): GridPiece | null => {
            const cand = floorItems.filter(test);
            if (cand.length === 0) return null;
            const need = c.capacity - c.count;
            if (c.count > 0) return cand.length >= need ? cand[0] : null;
            for (const p of cand) if (cand.filter(q => q.key === p.key).length >= need) return p;
            return null;
        };

        // 1) Hộp mở
        const open = this._containers.filter(c => !c.isClosed).sort((a, b) => b.count - a.count);
        for (const c of open) {
            const pick = pickFor(c, p => c.canAccept(p));
            if (pick) return { piece: pick, getEnd: () => c.node.worldPosition, tap: false };
        }
        // 2) Chạm đóng / mở
        for (const c of open) {
            if (c.count >= c.capacity) return { piece: c.piece, getEnd: null, tap: true };
        }
        for (const c of this._containers.filter(c => c.isClosed && c.count < c.capacity && c.piece.isOnFloor)) {
            if (pickFor(c, p => c.wouldAccept(p))) return { piece: c.piece, getEnd: null, tap: true };
        }
        // 3) Hộp đóng đủ đồ -> Main Box. 4) Đồ lẻ -> Main Box.
        const floorBoxes = this._containers.filter(c => c.isClosed && c.count >= c.capacity && c.piece.isOnFloor).map(c => c.piece);
        const boxable = (p: GridPiece) => this._containers.some(c => c.count < c.capacity && c.piece.isOnFloor && c.wouldAccept(p) && !!pickFor(c, q => c.wouldAccept(q)));
        const loose = floorItems.filter(p => !boxable(p));
        for (const p of floorBoxes.concat(loose)) {
            const spot = this.findSpotFor(p);
            if (spot) return { piece: p, getEnd: () => spot.board.getAreaCenterWorld(spot.col, spot.row, p.sizeW, p.sizeH), tap: false };
        }
        return null;
    }

    /** Ưu tiên ô lời giải (nếu set trên GridPiece), không thì ô trống đầu tiên vừa khít. */
    private findSpotFor(p: GridPiece): { board: GridBoard; col: number; row: number } | null {
        const sb = this.boards[p.solutionBoard];
        if (sb && sb.canPlace(p.solutionCol, p.solutionRow, p.sizeW, p.sizeH, p)) {
            return { board: sb, col: p.solutionCol, row: p.solutionRow };
        }
        for (const b of this.boards) {
            for (let r = 0; r <= b.rows - p.sizeH; r++) {
                for (let c = 0; c <= b.cols - p.sizeW; c++) {
                    if (b.canPlace(c, r, p.sizeW, p.sizeH, p)) return { board: b, col: c, row: r };
                }
            }
        }
        return null;
    }

    // ================================================================ Feedback / helpers

    private clearFeedback() {
        this.boards.forEach(b => b.clearHighlight());
        if (this._hoverContainer) this.setHover(this._hoverContainer, false);
        this._hoverContainer = null;
        this._evictShown.forEach(p => this.setEvictWarn(p, false));
        this._evictShown = [];
    }

    private setHover(c: PackContainer, on: boolean) {
        const n = c.node;
        // Scale gốc cố định của hộp (KHÔNG chụp n.scale: hộp có thể đang phình/nảy -> méo vĩnh viễn)
        const base = c.piece.isOnFloor ? c.baseScale.clone() : n.scale.clone();
        Tween.stopAllByTarget(n);
        if (on) {
            tween(n)
                .to(0.1, { scale: v3(base.x * 1.1, base.y * 1.1, 1) })
                .then(tween(n).repeatForever(tween(n)
                    .to(0.3, { scale: v3(base.x * 1.05, base.y * 1.05, 1) })
                    .to(0.3, { scale: v3(base.x * 1.1, base.y * 1.1, 1) })))
                .start();
        } else {
            tween(n).to(0.1, { scale: base }).start();
        }
    }

    private setEvictWarn(p: GridPiece, on: boolean) {
        const sp = p.getComponent(Sprite) || p.node.getChildByName('Main')?.getComponent(Sprite);
        const op = p.node.getComponent(UIOpacity) || p.node.addComponent(UIOpacity);
        Tween.stopAllByTarget(op);
        if (on) {
            if (sp) sp.color = this.evictTint;
            tween(op).repeatForever(tween(op).to(0.2, { opacity: 140 }).to(0.2, { opacity: 255 })).start();
        } else {
            if (sp) sp.color = Color.WHITE;
            op.opacity = 255;
        }
    }

    /**
     * Đưa piece lên trên cùng trên sàn. Hộp con thì chỉ lên tới ngay DƯỚI lớp đồ ăn
     * -> đồ ăn thả đè lên hộp (không đúng hộp) luôn nằm trên hộp.
     */
    private bringToFloorTop(p: GridPiece, parent: Node) {
        if (!p.getComponent(PackContainer)) {
            p.node.setSiblingIndex(parent.children.length - 1);
            return;
        }
        // Tìm node con của parent đang chứa đồ ăn trên sàn (VD "Items") -> đặt hộp ngay trước nó.
        let foodLayer: Node | null = null;
        for (const q of this._pieces) {
            if (q.getComponent(PackContainer) || !q.floorParent) continue;
            let n: Node | null = q.floorParent;
            while (n && n.parent !== parent) n = n.parent;
            if (n) { foodLayer = n; break; }
        }
        if (!foodLayer) { p.node.setSiblingIndex(parent.children.length - 1); return; }
        const cur = p.node.getSiblingIndex();
        const target = foodLayer.getSiblingIndex();
        p.node.setSiblingIndex(cur < target ? target - 1 : target);
    }

    private shake(n: Node) {
        const a = n.angle;
        Tween.stopAllByTarget(n);
        tween(n)
            .to(0.05, { angle: a + 6 }).to(0.05, { angle: a - 6 })
            .to(0.05, { angle: a + 4 }).to(0.05, { angle: a })
            .start();
    }

    private setOpacity(n: Node, v: number) {
        const op = n.getComponent(UIOpacity) || (v < 255 ? n.addComponent(UIOpacity) : null);
        if (op) op.opacity = v;
    }

    private spawnFx(world: Vec3) {
        if (!this.placeFx) return;
        const fx = instantiate(this.placeFx);
        const parent = this.dragLayer || this.node;
        parent.addChild(fx);
        fx.setWorldPosition(world);
        this.scheduleOnce(() => fx.isValid && fx.destroy(), 2);
    }

    private floorScaleOf(p: GridPiece): number {
        return Math.abs(p.floorWorldScale.x);
    }

    private setWorldScale(n: Node, s: number) {
        const ps = n.parent ? n.parent.worldScale : v3(1, 1, 1);
        n.setScale(s / Math.abs(ps.x || 1), s / Math.abs(ps.y || 1), 1);
    }

    private touchWorld(e: EventTouch): Vec3 {
        const l = e.getUILocation();
        return v3(l.x, l.y, 0);
    }
}
