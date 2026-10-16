// Visible grid, pointer ray intersection and native sketch commit share one plane.
export const ViewPlanes = Object.freeze({top:'xy',bottom:'xy',front:'xz',back:'xz',right:'yz',left:'yz'});
export const DefaultPlane = Object.freeze({origin:[0,0,0],x:[1,0,0],y:[0,1,0]});
export function GridView(View, Plane=DefaultPlane) {
  return {...View,LatticeOrigin:[...Plane.origin,0],LatticeAxisU:[...Plane.x,0],LatticeAxisV:[...Plane.y,0]};
}
