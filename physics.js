/* 笼中物理（cannon-es）：页面与 Node 回归测试共用同一套搭建代码。
   笼子是动力学 compound，经点约束悬挂在树枝锚点 —— 摆动来自真实重力，
   自转由角速度目标平滑驱动，物品与栏杆的碰撞（含卡位）全部交给解算器。 */
import * as CANNON from 'cannon-es';

export const CAGE = {
  pivotLocalY: 3.98,      // 悬挂枢轴高度（笼底中心局部系）= 链长 + 顶环
  barCount: 16,
  barR: 0.965,
  barH: 1.9,
  baseY: 0.1,             // 笼底板顶面
};

export function createPhysics({ origin = { x: 0, y: 0, z: 0 }, gravity = -9.0 } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.3;

  const matItem = new CANNON.Material('item');
  const matCage = new CANNON.Material('cage');
  world.addContactMaterial(new CANNON.ContactMaterial(matItem, matCage, { friction: 0.55, restitution: 0.38 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matItem, matItem, { friction: 0.4, restitution: 0.3 }));

  /* 笼子：动力学 compound（底盘 / 栏杆 / 穹顶锥壳 / 顶盖），质心即体原点（笼底中心） */
  const cageBody = new CANNON.Body({
    mass: 6, material: matCage,
    linearDamping: 0.05, angularDamping: 0.3, allowSleep: false,
  });
  cageBody.position.set(origin.x, origin.y, origin.z);
  cageBody.addShape(new CANNON.Box(new CANNON.Vec3(1.0, 0.05, 1.0)), new CANNON.Vec3(0, 0.05, 0));
  for (let i = 0; i < CAGE.barCount; i++) {
    const a = (i / CAGE.barCount) * Math.PI * 2;
    cageBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.03, CAGE.barH / 2, 0.03)),
      new CANNON.Vec3(Math.cos(a) * CAGE.barR, CAGE.baseY + CAGE.barH / 2, Math.sin(a) * CAGE.barR)
    );
  }
  const slope = Math.atan2(0.82, 1.0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(-Math.sin(a), 0, Math.cos(a)), slope);
    cageBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.03, 0.645, 0.55)),
      new CANNON.Vec3(Math.cos(a) * 0.53, 2.5, Math.sin(a) * 0.53),
      q
    );
  }
  cageBody.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.08, 0.15)), new CANNON.Vec3(0, 2.98, 0));
  /* 三道横向箍环（与视觉一致）：竖直栏杆挡不住下滑，头部由箍环接住（与真实鸟笼一致） */
  for (const [ry, rr] of [[0.1, 1.02], [1.0, 0.985], [2.0, 0.965]]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2 - a);
      cageBody.addShape(
        new CANNON.Box(new CANNON.Vec3(0.17, 0.045, 0.045)),
        new CANNON.Vec3(Math.cos(a) * rr, ry, Math.sin(a) * rr),
        q
      );
    }
  }
  world.addBody(cageBody);

  /* 悬挂锚点（静态）+ 点约束：真实单摆，摆动衰减靠角阻尼 */
  const anchor = new CANNON.Body({ mass: 0 });
  anchor.position.set(origin.x, origin.y + CAGE.pivotLocalY, origin.z);
  world.addBody(anchor);
  world.addConstraint(new CANNON.PointToPointConstraint(
    cageBody, new CANNON.Vec3(0, CAGE.pivotLocalY, 0),
    anchor, new CANNON.Vec3(0, 0, 0)
  ));

  /* 扳手：手柄 + 头部 复合盒；幺鸡：单盒 */
  const wrenchBody = new CANNON.Body({
    mass: 0.5, material: matItem,
    linearDamping: 0.05, angularDamping: 0.12, allowSleep: false,
  });
  wrenchBody.addShape(new CANNON.Box(new CANNON.Vec3(0.712, 0.099, 0.048)), new CANNON.Vec3(-0.184, 0, 0));
  wrenchBody.addShape(new CANNON.Box(new CANNON.Vec3(0.24, 0.24, 0.05)), new CANNON.Vec3(0.696, 0.088, 0));
  world.addBody(wrenchBody);

  const tileBody = new CANNON.Body({
    mass: 0.2, material: matItem,
    linearDamping: 0.05, angularDamping: 0.12, allowSleep: false,
  });
  tileBody.addShape(new CANNON.Box(new CANNON.Vec3(0.31, 0.46, 0.21)));
  world.addBody(tileBody);

  /* 初始位姿（笼局部）：扳手头部卡进 56.25° 栏杆间隙（正对默认相机） */
  function wedgeSpawn() {
    const phi = 56.25 * Math.PI / 180;
    const dir = new CANNON.Vec3(Math.cos(phi) * 0.55, 0.83, Math.sin(phi) * 0.55);
    dir.normalize();
    const q = new CANNON.Quaternion().setFromVectors(new CANNON.Vec3(1, 0, 0), dir);
    q.mult(new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), 50 * Math.PI / 180), q);
    const off = q.vmult(new CANNON.Vec3(0.696, 0.088, 0));
    const headC = new CANNON.Vec3(Math.cos(phi) * 1.02, 1.35, Math.sin(phi) * 1.02);
    return { p: headC.vsub(off), q };
  }
  const SPAWN = {
    wrench: wedgeSpawn(),
    tile: { p: new CANNON.Vec3(0.15, 0.62, 0.05), q: new CANNON.Quaternion().setFromEuler(-0.08, 0.5, 0) },
  };

  const _tmpV = new CANNON.Vec3();
  function resetBody(body, spawn) {          // 笼局部 → 世界（跟随当前笼位姿）
    cageBody.pointToWorldFrame(spawn.p, _tmpV);
    body.position.copy(_tmpV);
    cageBody.quaternion.mult(spawn.q, body.quaternion);
    cageBody.getVelocityAtWorldPoint(body.position, body.velocity);   // 跟随笼体运动，避免瞬移后被栏杆拍飞
    body.angularVelocity.copy(cageBody.angularVelocity);
    body.wakeUp();
  }
  resetBody(wrenchBody, SPAWN.wrench);
  resetBody(tileBody, SPAWN.tile);

  let spinTarget = 0;
  const VMAX = 25, WMAX = 30;                // 限速保险：拦下任何异常能量尖峰

  function step(dt) {
    cageBody.angularVelocity.y += (spinTarget - cageBody.angularVelocity.y) * Math.min(1, dt * 3);
    world.step(1 / 60, dt, 3);
    for (const b of [wrenchBody, tileBody]) {
      const v = b.velocity.length();
      if (v > VMAX) b.velocity.scale(VMAX / v, b.velocity);
      const w = b.angularVelocity.length();
      if (w > WMAX) b.angularVelocity.scale(WMAX / w, b.angularVelocity);
    }
  }

  function shake(active) {                   // 点击笼子：冲量推笼身，物品小幅受扰
    cageBody.wakeUp();
    const a = Math.random() * Math.PI * 2;
    const J = 4 + Math.random() * 4;
    cageBody.applyImpulse(new CANNON.Vec3(Math.cos(a) * J, 0, Math.sin(a) * J));
    const b = active === 'tile' ? tileBody : wrenchBody;
    b.wakeUp();
    b.applyImpulse(                          // 小幅扰动：物品主要随笼体晃动，而非各自乱飞
      new CANNON.Vec3((Math.random() * 2 - 1) * 0.35, 0.2 + Math.random() * 0.3, (Math.random() * 2 - 1) * 0.35),
      new CANNON.Vec3((Math.random() * 2 - 1) * 0.12, (Math.random() * 2 - 1) * 0.04, (Math.random() * 2 - 1) * 0.12)
    );
  }

  return {
    world, cageBody, wrenchBody, tileBody, SPAWN, resetBody, shake, step,
    setSpin: on => { spinTarget = on ? 0.35 : 0; },
  };
}
