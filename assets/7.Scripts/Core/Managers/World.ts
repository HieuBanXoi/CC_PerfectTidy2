import { _decorator, Component, game, Node, PhysicsSystem, Pool} from 'cc';
import { UI } from './UI';
import { MainCamera } from './MainCamera';
import { GameController } from '../../Platform/GameController';
import { PoolManager } from '../Pooling/PoolManager';
import { PoolMember } from '../Pooling/PoolMember';
const { ccclass, property, executeInEditMode } = _decorator;

@ccclass('World')
@executeInEditMode(true)
export class World extends Component {

    static instance: World = null!;
    static get ins() {
        if (!this.instance) {
            this.instance = new World();
        }
        return this.instance;
    }
    @property(UI)
    ui: UI = null!;
    
    @property(GameController)
    openStore: GameController = null; 

    @property(PoolManager)
    poolManager: PoolManager = null; 

    @property(MainCamera)
    camera: MainCamera = null; 

    despawn(node: Node) {
        this.poolManager.despawn(node.getComponent(PoolMember));
    }
    
    onLoad() {
        World.instance = this;
    }  

    start() {
        // PhysicsSystem.instance.maxSubSteps = 1;
        // game.frameRate = 60;
    }

    update(deltaTime: number) {  
    }
}


