// Learn TypeScript:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/typescript.html
// Learn Attribute:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/reference/attributes.html
// Learn life-cycle callbacks:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/life-cycle-callbacks.html

import { CCInteger, Component, Node, Prefab, Quat, Vec3, _decorator, instantiate, log, v3 } from "cc"; 
// import { PoolAmount } from "./PoolAmount";
import { PoolMember, PoolType } from "./PoolMember";
import PoolControl from "./PoolControl";

const { ccclass, property } = _decorator;


export class Pool {
  list: PoolMember[] = [];
  prefab: Prefab = null;
  root: Node = null;
  constructor(root: Node, prefab: Prefab, amount: number) {
    this.prefab = prefab;
    this.root = root;
    for (let i = 0; i < amount; i++) {
      let clone = instantiate(prefab).getComponent(PoolMember);
      clone.node.parent = root;
      clone.node.active = false;
      this.list.push(clone);
    }
  }

  spawn(position: Vec3, rotation: Quat): PoolMember {
    var clone: PoolMember = null;
    if (this.list.length == 0) {
      clone = instantiate(this.prefab).getComponent(PoolMember);
      clone.node.parent = this.root;
    } else {
      clone = this.list.pop();
    }
    clone.node.position = position;
    clone.node.rotation = rotation;
    clone.node.active = true;
    return clone;
  }

  despawn(clone: PoolMember) {
    clone.node.parent = this.root;
    clone.node.active = false;
    clone.node.position = v3(0, 0, 0);
    this.list.push(clone);
  }
}

@ccclass
export class PoolAmount {
  @property(Node)
  public root: Node = null;

  @property(Prefab)
  public prefab: Prefab = null;

  @property(CCInteger)
  public amount: number = 0;
}

export var pm: PoolManager = null;

@ccclass
export class PoolManager extends Component{

  
  @property(PoolControl)
  poolControll: PoolControl = null;
  
  link: Map<PoolType, Pool> = new Map<PoolType, Pool>();

  preLoad(poolAmounts: PoolAmount[]) {
    for (let i = 0; i < poolAmounts.length; i++) {
      let poolAmount = poolAmounts[i];
      let pool = new Pool(
        poolAmount.root,
        poolAmount.prefab,
        poolAmount.amount
      );
      let type = instantiate(poolAmount.prefab).getComponent(PoolMember).type;

      if (!this.link.has(type)) {
        this.link.set(type, pool);        
      }
      // console.log(this.link.get(type));
      
    }
  }

  spawn(type: PoolType, position: Vec3 = v3(), rotation: Quat = Quat.fromEuler(new Quat(), 0, 0, 0)): PoolMember {
    let pool = this.link.get(type);    
    if (!pool) {
      console.warn(`[PoolManager] No pool registered for PoolType ${PoolType[type] ?? type}.`);
      return null;
    }
    return pool.spawn(position, rotation);
  }
  
  spawnType<T>(type: PoolType, position: Vec3 = v3(), rotation: Quat = Quat.fromEuler(new Quat(), 0, 0, 0)): T {
    let pool = this.link.get(type);
    if (!pool) {
      console.warn(`[PoolManager] No pool registered for PoolType ${PoolType[type] ?? type}.`);
      return null;
    }
    return pool.spawn(position, rotation) as T;
  }

  despawn(clone: PoolMember) {
    if (!clone) return;
    let pool = this.link.get(clone.type);
    if (!pool) return;
    pool.despawn(clone);
  }

  onLoad() {
    pm = this;
    this.preLoad(this.poolControll.poolAmounts);
  }
    
}

