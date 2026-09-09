// Learn TypeScript:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/typescript.html
// Learn Attribute:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/reference/attributes.html
// Learn life-cycle callbacks:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/life-cycle-callbacks.html

import { CCInteger, Component, Node, Prefab, _decorator } from "cc"; 
// import { PoolAmount } from "./PoolAmount";
import { PoolMember, PoolType } from "./PoolMember";
import { PoolAmount, PoolManager } from "./PoolManager";

const { ccclass, property } = _decorator;


@ccclass('PoolControl')
export default class PoolControl extends Component {

  @property(Node)
  root: Node = null;
  @property([Prefab])
  prefabs: Prefab[] = [];

  @property({ type: CCInteger, tooltip: 'Number of instances to create for each prefab at startup.' })
  prewarmAmount: number = 0;

  poolAmounts: PoolAmount[] = [];

  preLoad() {
    this.prefabs.forEach((prefab, index) => {
      let poolAmount = new PoolAmount();
      poolAmount.root = this.root;
      poolAmount.prefab = prefab;
      poolAmount.amount = this.prewarmAmount;
      this.poolAmounts.push(poolAmount);
    })
  }

  // LIFE-CYCLE CALLBACKS:

  onLoad() {
    this.preLoad();
  }

  start() {
  }

  // update (dt) {}
}
