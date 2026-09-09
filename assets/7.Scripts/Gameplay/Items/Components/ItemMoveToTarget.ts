import { _decorator, Node, Tween, tween, Vec2, Vec3, Enum, EventHandler } from 'cc';
import { GameManager } from '../../Systems/GameManager';
import { InputManager } from '../../../Core/Managers/InputManager';
import { Item } from './Item';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';
import { FxType, Ply_SoundManager } from '../../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

export enum MoveType {
    Smooth = 0,
    Jump,
    Instant,
    ShakeThenMove
}
Enum(MoveType);

@ccclass('ItemMoveToTarget')
export class ItemMoveToTarget extends Ply_EventHandlerComponent {

    /** Emitted on this node after a move has completed. The target Node is passed as the event argument. */
    public static readonly EVENT_COMPLETE = 'item-move-to-target-complete';

    @property(Node)
    public defaultTarget: Node = null!;

    @property
    public duration: number = 0.5;

    @property({ type: Enum(MoveType) })
    public moveType: MoveType = MoveType.Smooth;

    @property({ tooltip: 'Độ cao cung nhảy UI theo pixel. Nên dùng khoảng 80-200.' })
    public jumpPower: number = 120;

    @property
    public numJumps: number = 1;

    @property
    public rotate360DuringJump: boolean = false;

    @property
    public flipRotate: boolean = false;

    @property
    public angleRotate: number = -360;

    @property
    public scaleOnMove: boolean = false;

    @property
    public endScaleMultiplier: number = 1.0;

    @property({ tooltip: 'Gán node cha về target sau khi đã di chuyển tới đích' })
    public setParentToTarget: boolean = false;

    @property({ tooltip: 'Reset node cha về originalParent và sibling index sau khi di chuyển tới đích (khi setParentToTarget = false)' })
    public resetParentOnComplete: boolean = true;

    @property({ type: [EventHandler], tooltip: 'On move complete event handlers' })
    public onComplete: EventHandler[] = [];

    @property
    public playMoveToTargetFinishSound: boolean = false;

    @property({ type: Enum(FxType) })
    public moveToTargetFinishFxType: FxType = FxType.Complete;

    @property
    public lockInputWhileMoving: boolean = true;

    private originalParent: Node | null = null;
    private originalSiblingIndex: number = -1;

    protected onLoad() {
        this.originalParent = this.node.parent;
        this.originalSiblingIndex = this.node.getSiblingIndex();
    }

    public ExecuteMove() {
        this.ExecuteMove2D(this.defaultTarget);
    }

    /** Kept for existing EventHandler bindings. Movement is now UI 2D. */
    public ExecuteMove3D(customTarget: Node | null) {
        this.ExecuteMove2D(customTarget);
    }

    public ExecuteMove2D(customTarget: Node | null) {
        const target = customTarget || this.defaultTarget;
        if (!target || !target.isValid) {
            console.warn(`[ItemMoveToTarget] Target not found for ${this.node.name}!`);
            return;
        }

        const getTargetPos = (): Vec3 => {
            const targetItem = target.getComponent(Item);
            if (targetItem && targetItem.knifePos && targetItem.knifePos.isValid) {
                return targetItem.knifePos.worldPosition;
            }
            return target.worldPosition;
        };

        const targetWorldPos = getTargetPos().clone();
        const startWorldPos = this.node.worldPosition.clone();
        const currentScale = this.node.scale.clone();

        Tween.stopAllByTarget(this.node);

        if (this.lockInputWhileMoving && GameManager.Ins) {
            GameManager.Ins.isPlaying = false;
        }

        const draggable = this.getComponent('ItemDraggable') as any;
        const dragMult = (draggable && typeof draggable.dragScaleMultiplier === 'number' && draggable.dragScaleMultiplier > 0)
            ? draggable.dragScaleMultiplier : 1.0;

        const zoomRatio = (InputManager.Ins && typeof InputManager.Ins.GetZoomScale === 'function')
            ? InputManager.Ins.GetZoomScale() : 1.0;

        const startScaleVec = currentScale.clone();
        const targetScaleVec = this.scaleOnMove
            ? currentScale.clone().multiplyScalar(this.endScaleMultiplier / dragMult)
            : (dragMult !== 1.0 ? currentScale.clone().multiplyScalar(1.0 / dragMult) : currentScale.clone());
        const shouldAnimateScale = this.scaleOnMove || dragMult !== 1.0;

        const curEuler = this.node.eulerAngles.clone();
        const rotAngle = this.flipRotate ? -this.angleRotate : this.angleRotate;

        const updateScaleAndRotation = (targetNode: Node, progress: number) => {
            if (shouldAnimateScale) {
                targetNode.setScale(
                    startScaleVec.x + (targetScaleVec.x - startScaleVec.x) * progress,
                    startScaleVec.y + (targetScaleVec.y - startScaleVec.y) * progress,
                    startScaleVec.z + (targetScaleVec.z - startScaleVec.z) * progress
                );
            }
            if (this.rotate360DuringJump && this.moveType === MoveType.Jump) {
                targetNode.setRotationFromEuler(curEuler.x, curEuler.y, curEuler.z + rotAngle * progress);
            }
        };

        const currentPos = new Vec3();

        switch (this.moveType) {
            case MoveType.Smooth:
                tween(this.node)
                    .to(this.duration, {}, {
                        easing: 'quadOut',
                        onUpdate: (targetNode: Node, ratio?: number) => {
                            const progress = ratio !== undefined ? ratio : 1.0;
                            currentPos.set(
                                startWorldPos.x + (targetWorldPos.x - startWorldPos.x) * progress,
                                startWorldPos.y + (targetWorldPos.y - startWorldPos.y) * progress,
                                startWorldPos.z
                            );
                            targetNode.setWorldPosition(currentPos);
                            updateScaleAndRotation(targetNode, progress);
                        }
                    })
                    .call(() => this.FinishAction(target))
                    .start();
                break;

            case MoveType.Jump:
                const totalArc = this.jumpPower * zoomRatio;
                tween(this.node)
                    .to(this.duration, {}, {
                        easing: 'sineOut',
                        onUpdate: (targetNode: Node, ratio?: number) => {
                            const progress = ratio !== undefined ? ratio : 1.0;
                            const arc = Math.sin(progress * Math.PI * this.numJumps) * totalArc;
                            currentPos.set(
                                startWorldPos.x + (targetWorldPos.x - startWorldPos.x) * progress,
                                startWorldPos.y + (targetWorldPos.y - startWorldPos.y) * progress + arc,
                                startWorldPos.z
                            );
                            targetNode.setWorldPosition(currentPos);
                            updateScaleAndRotation(targetNode, progress);
                        }
                    })
                    .call(() => this.FinishAction(target))
                    .start();
                break;

            case MoveType.Instant:
                this.node.setWorldPosition(targetWorldPos.x, targetWorldPos.y, startWorldPos.z);
                if (shouldAnimateScale) this.node.setScale(targetScaleVec);
                this.FinishAction(target);
                break;

            case MoveType.ShakeThenMove:
                const shakeAmount = 10 * zoomRatio;
                tween(this.node)
                    .to(0.1, {}, {
                        onUpdate: (targetNode: Node, ratio?: number) => {
                            const p = ratio !== undefined ? ratio : 1.0;
                            targetNode.setWorldPosition(startWorldPos.x + shakeAmount * p, startWorldPos.y, startWorldPos.z);
                        }
                    })
                    .to(0.1, {}, {
                        onUpdate: (targetNode: Node, ratio?: number) => {
                            const p = ratio !== undefined ? ratio : 1.0;
                            targetNode.setWorldPosition(startWorldPos.x - shakeAmount * p, startWorldPos.y, startWorldPos.z);
                        }
                    })
                    .to(0.1, {}, {
                        onUpdate: (targetNode: Node, ratio?: number) => {
                            const p = ratio !== undefined ? ratio : 1.0;
                            targetNode.setWorldPosition(startWorldPos.x, startWorldPos.y, startWorldPos.z);
                        }
                    })
                    .to(this.duration, {}, {
                        easing: 'quadOut',
                        onUpdate: (targetNode: Node, ratio?: number) => {
                            const progress = ratio !== undefined ? ratio : 1.0;
                            currentPos.set(
                                startWorldPos.x + (targetWorldPos.x - startWorldPos.x) * progress,
                                startWorldPos.y + (targetWorldPos.y - startWorldPos.y) * progress,
                                startWorldPos.z
                            );
                            targetNode.setWorldPosition(currentPos);
                            updateScaleAndRotation(targetNode, progress);
                        }
                    })
                    .call(() => this.FinishAction(target))
                    .start();
                break;
        }
    }

    private FinishAction(targetNode?: Node | null) {
        const target = targetNode || this.defaultTarget;

        if (this.setParentToTarget && target && target.isValid) {
            const currentWorldPos = this.node.worldPosition.clone();
            const currentWorldScale = this.node.worldScale.clone();
            const currentWorldRotation = this.node.worldRotation.clone();

            this.node.setParent(target);
            this.node.setWorldPosition(currentWorldPos);
            this.node.setWorldScale(currentWorldScale);
            this.node.setWorldRotation(currentWorldRotation);
        } else if (this.resetParentOnComplete && this.originalParent && this.originalParent.isValid && this.node.parent !== this.originalParent) {
            const currentWorldPos = this.node.worldPosition.clone();
            const currentWorldScale = this.node.worldScale.clone();
            const currentWorldRotation = this.node.worldRotation.clone();

            this.node.setParent(this.originalParent);
            this.node.setWorldPosition(currentWorldPos);
            this.node.setWorldScale(currentWorldScale);
            this.node.setWorldRotation(currentWorldRotation);

            if (this.originalSiblingIndex >= 0 && this.originalSiblingIndex < this.originalParent.children.length) {
                this.node.setSiblingIndex(this.originalSiblingIndex);
            }
        }

        if (this.lockInputWhileMoving && GameManager.Ins) {
            GameManager.Ins.isPlaying = true;
        }

        if (InputManager.Ins) {
            InputManager.Ins.isDragging = false;
        }

        if (this.playMoveToTargetFinishSound) {
            Ply_SoundManager.Ins.PlayFx(this.moveToTargetFinishFxType);
        }

        EventHandler.emitEvents(this.onComplete);
        this.node.emit(ItemMoveToTarget.EVENT_COMPLETE, target);
    }

    public TeleportToTarget(t: Node) {
        if (t && t.isValid) {
            const target = t.worldPosition;
            this.node.setWorldPosition(target.x, target.y, this.node.worldPosition.z);
        }
    }

    public SetDefaultTarget(t: Node) {
        this.defaultTarget = t;
    }

    public SetEndScale(scale: number) {
        this.endScaleMultiplier = scale;
    }
}
