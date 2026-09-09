import { _decorator, Camera, Component, EventKeyboard, EventTouch, geometry, Input, input, KeyCode, Node, PhysicsSystem, Vec2 } from 'cc';
import { World } from './World';
const { ccclass, property } = _decorator;

/** Active PointerController instance used by legacy input helpers such as Zoom. */
export let pc: PointerController | null = null;

@ccclass('PointerController')
export class PointerController extends Component {

    static instance: PointerController = null!;
    static get ins() {
        if (!this.instance) {
            this.instance = new PointerController();
        }
        return this.instance;
    }
    @property(Camera)
    camera: Camera = null!;    
    raycast: geometry.Ray = new geometry.Ray();
    currentSlot: Node = null!;
    desSlot: Node = null!;   
    moving: boolean = false;
    speed: number = 35;
    firstCake: boolean = false;
    @property
    creativeMode: boolean = false;
    currentNode: Node = null!;
    public bindingStart: (event: EventTouch) => void = () => {};
    public bindingMove: (event: EventTouch) => void = () => {};
    public bindingEnd: (event: EventTouch) => void = () => {};

    onLoad() {
        PointerController.instance = this;
        pc = this;
    }

    bindingEvent() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    unBindingEvent() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onStore() {
        console.log("binding");
        
        input.on(Input.EventType.TOUCH_START, () => {
            World.ins.ui.openStore();
        });
    }

    onTouchStart(event: EventTouch) {
        if(this.moving) return;
        let slot = this.rayCastDetect(event.getLocation())?.slot;
        if(slot) {
        }
        this.bindingStart(event);
        
    }

    onTouchMove(event: EventTouch) { 
        if(this.moving) return;
        this.bindingMove(event);
    }

    onTouchEnd(event: EventTouch) {
        if(this.moving) return;
        this.bindingEnd(event);
    }

    rayCastDetect(pos: Vec2, layer: number = 1) {
        this.camera.screenPointToRay(pos.x, pos.y, this.raycast);
        if(PhysicsSystem.instance.raycast(this.raycast)) {
            let result = PhysicsSystem.instance.raycastResults;
            for(let i = 0; i < result.length; i++) {
                let slot = result[i].collider.node;
                let hitPoint = result[i].hitPoint;
                if(slot.layer === layer) {                    
                    return {
                        slot: slot,
                        hitPoint: hitPoint
                    }
                }
            }
            return null;            
        }
    }

    onKeyDown(event: EventKeyboard) {
        let multiplier = 0.05;
        let angle = 0.5
        if(this.currentNode)
        switch(event.keyCode) {
            case KeyCode.SPACE: 
            console.log("Print Data");     
                break;
            case KeyCode.KEY_A:
                this.currentNode.position = this.currentNode.position.add3f(-multiplier, 0, 0);
                break;
            case KeyCode.KEY_W:
                this.currentNode.position = this.currentNode.position.add3f(0, 0, -multiplier);
                break;
            case KeyCode.KEY_D:
                this.currentNode.position = this.currentNode.position.add3f(multiplier, 0, 0);
                break;
            case KeyCode.KEY_S:
                this.currentNode.position = this.currentNode.position.add3f(0, 0, multiplier);
                break;
            case KeyCode.KEY_Q:
                this.currentNode.eulerAngles = this.currentNode.eulerAngles.add3f(0, -angle, 0);
                break;
            case KeyCode.KEY_E:
                this.currentNode.eulerAngles = this.currentNode.eulerAngles.add3f(0, angle, 0);
                break;
        }
        
    }

    start() {
        if(this.creativeMode) {
            input.on(Input.EventType.KEY_PRESSING, this.onKeyDown, this);
            input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        }
        // this.bindingEvent();
    }

    onDestroy() {
        this.unBindingEvent();
        if (PointerController.instance === this) PointerController.instance = null!;
        if (pc === this) pc = null;
    }

    

    update(deltaTime: number) {
    }
}


