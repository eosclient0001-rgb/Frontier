var to="160",oi={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},li={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},ch=0,Io=1,hh=2;var hc=1,no=2,Sn=3,Hn=0,Rt=1,wn=2;var Bn=0,Li=1,Do=2,Uo=3,No=4,uh=5,Qn=100,dh=101,fh=102,Fo=103,Oo=104,ph=200,mh=201,gh=202,_h=203,xa=204,va=205,xh=206,vh=207,yh=208,Mh=209,bh=210,Sh=211,wh=212,Eh=213,Th=214,Ah=0,Rh=1,Ch=2,Ys=3,Ph=4,Lh=5,Ih=6,Dh=7,uc=0,Uh=1,Nh=2,zn=0,Fh=1,Oh=2,Bh=3,io=4,zh=5,kh=6;var dc=300,Ui=301,Ni=302,ya=303,Ma=304,Tr=306,ba=1e3,Ht=1001,Sa=1002,yt=1003,Bo=1004;var Hr=1005;var Nt=1006,Hh=1007;var rs=1008;var kn=1009,Vh=1010,Gh=1011,so=1012,fc=1013,Fn=1014,On=1015,as=1016,pc=1017,mc=1018,ti=1020,Wh=1021,Xt=1023,Xh=1024,qh=1025,ni=1026,Fi=1027,Yh=1028,gc=1029,Zh=1030,_c=1031,xc=1033,Vr=33776,Gr=33777,Wr=33778,Xr=33779,zo=35840,ko=35841,Ho=35842,Vo=35843,vc=36196,Go=37492,Wo=37496,Xo=37808,qo=37809,Yo=37810,Zo=37811,Jo=37812,$o=37813,Ko=37814,jo=37815,Qo=37816,el=37817,tl=37818,nl=37819,il=37820,sl=37821,qr=36492,rl=36494,al=36495,Jh=36283,ol=36284,ll=36285,cl=36286;var Zs=2300,Js=2301,Yr=2302,hl=2400,ul=2401,dl=2402;var yc=3e3,ii=3001,$h=3200,Kh=3201,Mc=0,jh=1,Kt="",Mt="srgb",Tn="srgb-linear",ro="display-p3",Ar="display-p3-linear",$s="linear",et="srgb",Ks="rec709",js="p3";var hi=7680;var fl=519,Qh=512,eu=513,tu=514,bc=515,nu=516,iu=517,su=518,ru=519,pl=35044;var ml="300 es",wa=1035,En=2e3,Qs=2001,fn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;let n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;let s=this._listeners[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;let n=this._listeners[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}},Et=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],gl=1234567,ts=Math.PI/180,os=180/Math.PI;function Hi(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Et[i&255]+Et[i>>8&255]+Et[i>>16&255]+Et[i>>24&255]+"-"+Et[e&255]+Et[e>>8&255]+"-"+Et[e>>16&15|64]+Et[e>>24&255]+"-"+Et[t&63|128]+Et[t>>8&255]+"-"+Et[t>>16&255]+Et[t>>24&255]+Et[n&255]+Et[n>>8&255]+Et[n>>16&255]+Et[n>>24&255]).toLowerCase()}function At(i,e,t){return Math.max(e,Math.min(t,i))}function ao(i,e){return(i%e+e)%e}function au(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function ou(i,e,t){return i!==e?(t-i)/(e-i):0}function ns(i,e,t){return(1-t)*i+t*e}function lu(i,e,t,n){return ns(i,e,1-Math.exp(-t*n))}function cu(i,e=1){return e-Math.abs(ao(i,e*2)-e)}function hu(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function uu(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function du(i,e){return i+Math.floor(Math.random()*(e-i+1))}function fu(i,e){return i+Math.random()*(e-i)}function pu(i){return i*(.5-Math.random())}function mu(i){i!==void 0&&(gl=i);let e=gl+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function gu(i){return i*ts}function _u(i){return i*os}function Ea(i){return(i&i-1)===0&&i!==0}function xu(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function er(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function vu(i,e,t,n,s){let r=Math.cos,o=Math.sin,a=r(t/2),l=o(t/2),c=r((e+n)/2),h=o((e+n)/2),u=r((e-n)/2),f=o((e-n)/2),g=r((n-e)/2),_=o((n-e)/2);switch(s){case"XYX":i.set(a*h,l*u,l*f,a*c);break;case"YZY":i.set(l*f,a*h,l*u,a*c);break;case"ZXZ":i.set(l*u,l*f,a*h,a*c);break;case"XZX":i.set(a*h,l*_,l*g,a*c);break;case"YXY":i.set(l*g,a*h,l*_,a*c);break;case"ZYZ":i.set(l*_,l*g,a*h,a*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function Ai(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Dt(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}var qt={DEG2RAD:ts,RAD2DEG:os,generateUUID:Hi,clamp:At,euclideanModulo:ao,mapLinear:au,inverseLerp:ou,lerp:ns,damp:lu,pingpong:cu,smoothstep:hu,smootherstep:uu,randInt:du,randFloat:fu,randFloatSpread:pu,seededRandom:mu,degToRad:gu,radToDeg:_u,isPowerOfTwo:Ea,ceilPowerOfTwo:xu,floorPowerOfTwo:er,setQuaternionFromProperEuler:vu,normalize:Dt,denormalize:Ai},De=class i{constructor(e=0,t=0){i.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(At(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Xe=class i{constructor(e,t,n,s,r,o,a,l,c){i.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c)}set(e,t,n,s,r,o,a,l,c){let h=this.elements;return h[0]=e,h[1]=s,h[2]=a,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=o,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],h=n[4],u=n[7],f=n[2],g=n[5],_=n[8],m=s[0],p=s[3],d=s[6],M=s[1],v=s[4],T=s[7],P=s[2],R=s[5],A=s[8];return r[0]=o*m+a*M+l*P,r[3]=o*p+a*v+l*R,r[6]=o*d+a*T+l*A,r[1]=c*m+h*M+u*P,r[4]=c*p+h*v+u*R,r[7]=c*d+h*T+u*A,r[2]=f*m+g*M+_*P,r[5]=f*p+g*v+_*R,r[8]=f*d+g*T+_*A,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8];return t*o*h-t*a*c-n*r*h+n*a*l+s*r*c-s*o*l}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8],u=h*o-a*c,f=a*l-h*r,g=c*r-o*l,_=t*u+n*f+s*g;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/_;return e[0]=u*m,e[1]=(s*c-h*n)*m,e[2]=(a*n-s*o)*m,e[3]=f*m,e[4]=(h*t-s*l)*m,e[5]=(s*r-a*t)*m,e[6]=g*m,e[7]=(n*l-c*t)*m,e[8]=(o*t-n*r)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+e,-s*c,s*l,-s*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(Zr.makeScale(e,t)),this}rotate(e){return this.premultiply(Zr.makeRotation(-e)),this}translate(e,t){return this.premultiply(Zr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Zr=new Xe;function Sc(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function tr(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function yu(){let i=tr("canvas");return i.style.display="block",i}var _l={};function is(i){i in _l||(_l[i]=!0,console.warn(i))}var xl=new Xe().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),vl=new Xe().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),bs={[Tn]:{transfer:$s,primaries:Ks,toReference:i=>i,fromReference:i=>i},[Mt]:{transfer:et,primaries:Ks,toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[Ar]:{transfer:$s,primaries:js,toReference:i=>i.applyMatrix3(vl),fromReference:i=>i.applyMatrix3(xl)},[ro]:{transfer:et,primaries:js,toReference:i=>i.convertSRGBToLinear().applyMatrix3(vl),fromReference:i=>i.applyMatrix3(xl).convertLinearToSRGB()}},Mu=new Set([Tn,Ar]),$e={enabled:!0,_workingColorSpace:Tn,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!Mu.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,e,t){if(this.enabled===!1||e===t||!e||!t)return i;let n=bs[e].toReference,s=bs[t].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,e){return this.convert(i,this._workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this._workingColorSpace)},getPrimaries:function(i){return bs[i].primaries},getTransfer:function(i){return i===Kt?$s:bs[i].transfer}};function Ii(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Jr(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var ui,nr=class{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{ui===void 0&&(ui=tr("canvas")),ui.width=e.width,ui.height=e.height;let n=ui.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=ui}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=tr("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=Ii(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Ii(t[n]/255)*255):t[n]=Ii(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},bu=0,ir=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:bu++}),this.uuid=Hi(),this.data=e,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push($r(s[o].image)):r.push($r(s[o]))}else r=$r(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function $r(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?nr.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var Su=0,Qt=class i extends fn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=Ht,s=Ht,r=Nt,o=rs,a=Xt,l=kn,c=i.DEFAULT_ANISOTROPY,h=Kt){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Su++}),this.uuid=Hi(),this.name="",this.source=new ir(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new De(0,0),this.repeat=new De(1,1),this.center=new De(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Xe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,typeof h=="string"?this.colorSpace=h:(is("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=h===ii?Mt:Kt),this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.needsPMREMUpdate=!1}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==dc)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ba:e.x=e.x-Math.floor(e.x);break;case Ht:e.x=e.x<0?0:1;break;case Sa:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ba:e.y=e.y-Math.floor(e.y);break;case Ht:e.y=e.y<0?0:1;break;case Sa:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}get encoding(){return is("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace===Mt?ii:yc}set encoding(e){is("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=e===ii?Mt:Kt}};Qt.DEFAULT_IMAGE=null;Qt.DEFAULT_MAPPING=dc;Qt.DEFAULT_ANISOTROPY=1;var _t=class i{constructor(e=0,t=0,n=0,s=1){i.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,l=e.elements,c=l[0],h=l[4],u=l[8],f=l[1],g=l[5],_=l[9],m=l[2],p=l[6],d=l[10];if(Math.abs(h-f)<.01&&Math.abs(u-m)<.01&&Math.abs(_-p)<.01){if(Math.abs(h+f)<.1&&Math.abs(u+m)<.1&&Math.abs(_+p)<.1&&Math.abs(c+g+d-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let v=(c+1)/2,T=(g+1)/2,P=(d+1)/2,R=(h+f)/4,A=(u+m)/4,X=(_+p)/4;return v>T&&v>P?v<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(v),s=R/n,r=A/n):T>P?T<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(T),n=R/s,r=X/s):P<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(P),n=A/r,s=X/r),this.set(n,s,r,t),this}let M=Math.sqrt((p-_)*(p-_)+(u-m)*(u-m)+(f-h)*(f-h));return Math.abs(M)<.001&&(M=1),this.x=(p-_)/M,this.y=(u-m)/M,this.z=(f-h)/M,this.w=Math.acos((c+g+d-1)/2),this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Ta=class extends fn{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new _t(0,0,e,t),this.scissorTest=!1,this.viewport=new _t(0,0,e,t);let s={width:e,height:t,depth:1};n.encoding!==void 0&&(is("THREE.WebGLRenderTarget: option.encoding has been replaced by option.colorSpace."),n.colorSpace=n.encoding===ii?Mt:Kt),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Nt,depthBuffer:!0,stencilBuffer:!1,depthTexture:null,samples:0},n),this.texture=new Qt(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.flipY=!1,this.texture.generateMipmaps=n.generateMipmaps,this.texture.internalFormat=n.internalFormat,this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}setSize(e,t,n=1){(this.width!==e||this.height!==t||this.depth!==n)&&(this.width=e,this.height=t,this.depth=n,this.texture.image.width=e,this.texture.image.height=t,this.texture.image.depth=n,this.dispose()),this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.texture=e.texture.clone(),this.texture.isRenderTargetTexture=!0;let t=Object.assign({},e.texture.image);return this.texture.source=new ir(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},An=class extends Ta{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},sr=class extends Qt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=yt,this.minFilter=yt,this.wrapR=Ht,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Aa=class extends Qt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=yt,this.minFilter=yt,this.wrapR=Ht,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var an=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let l=n[s+0],c=n[s+1],h=n[s+2],u=n[s+3],f=r[o+0],g=r[o+1],_=r[o+2],m=r[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u;return}if(a===1){e[t+0]=f,e[t+1]=g,e[t+2]=_,e[t+3]=m;return}if(u!==m||l!==f||c!==g||h!==_){let p=1-a,d=l*f+c*g+h*_+u*m,M=d>=0?1:-1,v=1-d*d;if(v>Number.EPSILON){let P=Math.sqrt(v),R=Math.atan2(P,d*M);p=Math.sin(p*R)/P,a=Math.sin(a*R)/P}let T=a*M;if(l=l*p+f*T,c=c*p+g*T,h=h*p+_*T,u=u*p+m*T,p===1-a){let P=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=P,c*=P,h*=P,u*=P}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,o){let a=n[s],l=n[s+1],c=n[s+2],h=n[s+3],u=r[o],f=r[o+1],g=r[o+2],_=r[o+3];return e[t]=a*_+h*u+l*g-c*f,e[t+1]=l*_+h*f+c*u-a*g,e[t+2]=c*_+h*g+a*f-l*u,e[t+3]=h*_-a*u-l*f-c*g,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(n/2),h=a(s/2),u=a(r/2),f=l(n/2),g=l(s/2),_=l(r/2);switch(o){case"XYZ":this._x=f*h*u+c*g*_,this._y=c*g*u-f*h*_,this._z=c*h*_+f*g*u,this._w=c*h*u-f*g*_;break;case"YXZ":this._x=f*h*u+c*g*_,this._y=c*g*u-f*h*_,this._z=c*h*_-f*g*u,this._w=c*h*u+f*g*_;break;case"ZXY":this._x=f*h*u-c*g*_,this._y=c*g*u+f*h*_,this._z=c*h*_+f*g*u,this._w=c*h*u-f*g*_;break;case"ZYX":this._x=f*h*u-c*g*_,this._y=c*g*u+f*h*_,this._z=c*h*_-f*g*u,this._w=c*h*u+f*g*_;break;case"YZX":this._x=f*h*u+c*g*_,this._y=c*g*u+f*h*_,this._z=c*h*_-f*g*u,this._w=c*h*u-f*g*_;break;case"XZY":this._x=f*h*u-c*g*_,this._y=c*g*u-f*h*_,this._z=c*h*_+f*g*u,this._w=c*h*u+f*g*_;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],l=t[9],c=t[2],h=t[6],u=t[10],f=n+a+u;if(f>0){let g=.5/Math.sqrt(f+1);this._w=.25/g,this._x=(h-l)*g,this._y=(r-c)*g,this._z=(o-s)*g}else if(n>a&&n>u){let g=2*Math.sqrt(1+n-a-u);this._w=(h-l)/g,this._x=.25*g,this._y=(s+o)/g,this._z=(r+c)/g}else if(a>u){let g=2*Math.sqrt(1+a-n-u);this._w=(r-c)/g,this._x=(s+o)/g,this._y=.25*g,this._z=(l+h)/g}else{let g=2*Math.sqrt(1+u-n-a);this._w=(o-s)/g,this._x=(r+c)/g,this._y=(l+h)/g,this._z=.25*g}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(At(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+o*a+s*c-r*l,this._y=s*h+o*l+r*a-n*c,this._z=r*h+o*c+n*l-s*a,this._w=o*h-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,s=this._y,r=this._z,o=this._w,a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;let l=1-a*a;if(l<=Number.EPSILON){let g=1-t;return this._w=g*o+t*this._w,this._x=g*n+t*this._x,this._y=g*s+t*this._y,this._z=g*r+t*this._z,this.normalize(),this}let c=Math.sqrt(l),h=Math.atan2(c,a),u=Math.sin((1-t)*h)/c,f=Math.sin(t*h)/c;return this._w=o*u+this._w*f,this._x=n*u+this._x*f,this._y=s*u+this._y*f,this._z=r*u+this._z*f,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=Math.random(),t=Math.sqrt(1-e),n=Math.sqrt(e),s=2*Math.PI*Math.random(),r=2*Math.PI*Math.random();return this.set(t*Math.cos(s),n*Math.sin(r),n*Math.cos(r),t*Math.sin(s))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},D=class i{constructor(e=0,t=0,n=0){i.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(yl.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(yl.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*s-a*n),h=2*(a*t-r*s),u=2*(r*n-o*t);return this.x=t+l*c+o*u-a*h,this.y=n+l*h+a*c-r*u,this.z=s+l*u+r*h-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,l=t.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Kr.copy(this).projectOnVector(e),this.sub(Kr)}reflect(e){return this.sub(Kr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(At(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=(Math.random()-.5)*2,t=Math.random()*Math.PI*2,n=Math.sqrt(1-e**2);return this.x=n*Math.cos(t),this.y=n*Math.sin(t),this.z=e,this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Kr=new D,yl=new an,Rn=class{constructor(e=new D(1/0,1/0,1/0),t=new D(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(tn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(tn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=tn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,tn):tn.fromBufferAttribute(r,o),tn.applyMatrix4(e.matrixWorld),this.expandByPoint(tn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Ss.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Ss.copy(n.boundingBox)),Ss.applyMatrix4(e.matrixWorld),this.union(Ss)}let s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return!(e.x<this.min.x||e.x>this.max.x||e.y<this.min.y||e.y>this.max.y||e.z<this.min.z||e.z>this.max.z)}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return!(e.max.x<this.min.x||e.min.x>this.max.x||e.max.y<this.min.y||e.min.y>this.max.y||e.max.z<this.min.z||e.min.z>this.max.z)}intersectsSphere(e){return this.clampPoint(e.center,tn),tn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ji),ws.subVectors(this.max,Ji),di.subVectors(e.a,Ji),fi.subVectors(e.b,Ji),pi.subVectors(e.c,Ji),Ln.subVectors(fi,di),In.subVectors(pi,fi),Zn.subVectors(di,pi);let t=[0,-Ln.z,Ln.y,0,-In.z,In.y,0,-Zn.z,Zn.y,Ln.z,0,-Ln.x,In.z,0,-In.x,Zn.z,0,-Zn.x,-Ln.y,Ln.x,0,-In.y,In.x,0,-Zn.y,Zn.x,0];return!jr(t,di,fi,pi,ws)||(t=[1,0,0,0,1,0,0,0,1],!jr(t,di,fi,pi,ws))?!1:(Es.crossVectors(Ln,In),t=[Es.x,Es.y,Es.z],jr(t,di,fi,pi,ws))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,tn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(tn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(xn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),xn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),xn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),xn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),xn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),xn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),xn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),xn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(xn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}},xn=[new D,new D,new D,new D,new D,new D,new D,new D],tn=new D,Ss=new Rn,di=new D,fi=new D,pi=new D,Ln=new D,In=new D,Zn=new D,Ji=new D,ws=new D,Es=new D,Jn=new D;function jr(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){Jn.fromArray(i,r);let a=s.x*Math.abs(Jn.x)+s.y*Math.abs(Jn.y)+s.z*Math.abs(Jn.z),l=e.dot(Jn),c=t.dot(Jn),h=n.dot(Jn);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>a)return!1}return!0}var wu=new Rn,$i=new D,Qr=new D,Vn=class{constructor(e=new D,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):wu.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;$i.subVectors(e,this.center);let t=$i.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector($i,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Qr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint($i.copy(e.center).add(Qr)),this.expandByPoint($i.copy(e.center).sub(Qr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}},vn=new D,ea=new D,Ts=new D,Dn=new D,ta=new D,As=new D,na=new D,Oi=class{constructor(e=new D,t=new D(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,vn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=vn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(vn.copy(this.origin).addScaledVector(this.direction,t),vn.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){ea.copy(e).add(t).multiplyScalar(.5),Ts.copy(t).sub(e).normalize(),Dn.copy(this.origin).sub(ea);let r=e.distanceTo(t)*.5,o=-this.direction.dot(Ts),a=Dn.dot(this.direction),l=-Dn.dot(Ts),c=Dn.lengthSq(),h=Math.abs(1-o*o),u,f,g,_;if(h>0)if(u=o*l-a,f=o*a-l,_=r*h,u>=0)if(f>=-_)if(f<=_){let m=1/h;u*=m,f*=m,g=u*(u+o*f+2*a)+f*(o*u+f+2*l)+c}else f=r,u=Math.max(0,-(o*f+a)),g=-u*u+f*(f+2*l)+c;else f=-r,u=Math.max(0,-(o*f+a)),g=-u*u+f*(f+2*l)+c;else f<=-_?(u=Math.max(0,-(-o*r+a)),f=u>0?-r:Math.min(Math.max(-r,-l),r),g=-u*u+f*(f+2*l)+c):f<=_?(u=0,f=Math.min(Math.max(-r,-l),r),g=f*(f+2*l)+c):(u=Math.max(0,-(o*r+a)),f=u>0?r:Math.min(Math.max(-r,-l),r),g=-u*u+f*(f+2*l)+c);else f=o>0?-r:r,u=Math.max(0,-(o*f+a)),g=-u*u+f*(f+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(ea).addScaledVector(Ts,f),g}intersectSphere(e,t){vn.subVectors(e.center,this.origin);let n=vn.dot(this.direction),s=vn.dot(vn)-n*n,r=e.radius*e.radius;if(s>r)return null;let o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,l,c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,f=this.origin;return c>=0?(n=(e.min.x-f.x)*c,s=(e.max.x-f.x)*c):(n=(e.max.x-f.x)*c,s=(e.min.x-f.x)*c),h>=0?(r=(e.min.y-f.y)*h,o=(e.max.y-f.y)*h):(r=(e.max.y-f.y)*h,o=(e.min.y-f.y)*h),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),u>=0?(a=(e.min.z-f.z)*u,l=(e.max.z-f.z)*u):(a=(e.max.z-f.z)*u,l=(e.min.z-f.z)*u),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,vn)!==null}intersectTriangle(e,t,n,s,r){ta.subVectors(t,e),As.subVectors(n,e),na.crossVectors(ta,As);let o=this.direction.dot(na),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Dn.subVectors(this.origin,e);let l=a*this.direction.dot(As.crossVectors(Dn,As));if(l<0)return null;let c=a*this.direction.dot(ta.cross(Dn));if(c<0||l+c>o)return null;let h=-a*Dn.dot(na);return h<0?null:this.at(h/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},rt=class i{constructor(e,t,n,s,r,o,a,l,c,h,u,f,g,_,m,p){i.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c,h,u,f,g,_,m,p)}set(e,t,n,s,r,o,a,l,c,h,u,f,g,_,m,p){let d=this.elements;return d[0]=e,d[4]=t,d[8]=n,d[12]=s,d[1]=r,d[5]=o,d[9]=a,d[13]=l,d[2]=c,d[6]=h,d[10]=u,d[14]=f,d[3]=g,d[7]=_,d[11]=m,d[15]=p,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,s=1/mi.setFromMatrixColumn(e,0).length(),r=1/mi.setFromMatrixColumn(e,1).length(),o=1/mi.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let f=o*h,g=o*u,_=a*h,m=a*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=g+_*c,t[5]=f-m*c,t[9]=-a*l,t[2]=m-f*c,t[6]=_+g*c,t[10]=o*l}else if(e.order==="YXZ"){let f=l*h,g=l*u,_=c*h,m=c*u;t[0]=f+m*a,t[4]=_*a-g,t[8]=o*c,t[1]=o*u,t[5]=o*h,t[9]=-a,t[2]=g*a-_,t[6]=m+f*a,t[10]=o*l}else if(e.order==="ZXY"){let f=l*h,g=l*u,_=c*h,m=c*u;t[0]=f-m*a,t[4]=-o*u,t[8]=_+g*a,t[1]=g+_*a,t[5]=o*h,t[9]=m-f*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){let f=o*h,g=o*u,_=a*h,m=a*u;t[0]=l*h,t[4]=_*c-g,t[8]=f*c+m,t[1]=l*u,t[5]=m*c+f,t[9]=g*c-_,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){let f=o*l,g=o*c,_=a*l,m=a*c;t[0]=l*h,t[4]=m-f*u,t[8]=_*u+g,t[1]=u,t[5]=o*h,t[9]=-a*h,t[2]=-c*h,t[6]=g*u+_,t[10]=f-m*u}else if(e.order==="XZY"){let f=o*l,g=o*c,_=a*l,m=a*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=f*u+m,t[5]=o*h,t[9]=g*u-_,t[2]=_*u-g,t[6]=a*h,t[10]=m*u+f}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Eu,e,Tu)}lookAt(e,t,n){let s=this.elements;return Gt.subVectors(e,t),Gt.lengthSq()===0&&(Gt.z=1),Gt.normalize(),Un.crossVectors(n,Gt),Un.lengthSq()===0&&(Math.abs(n.z)===1?Gt.x+=1e-4:Gt.z+=1e-4,Gt.normalize(),Un.crossVectors(n,Gt)),Un.normalize(),Rs.crossVectors(Gt,Un),s[0]=Un.x,s[4]=Rs.x,s[8]=Gt.x,s[1]=Un.y,s[5]=Rs.y,s[9]=Gt.y,s[2]=Un.z,s[6]=Rs.z,s[10]=Gt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],h=n[1],u=n[5],f=n[9],g=n[13],_=n[2],m=n[6],p=n[10],d=n[14],M=n[3],v=n[7],T=n[11],P=n[15],R=s[0],A=s[4],X=s[8],b=s[12],w=s[1],N=s[5],ee=s[9],ue=s[13],I=s[2],U=s[6],q=s[10],Q=s[14],j=s[3],J=s[7],te=s[11],re=s[15];return r[0]=o*R+a*w+l*I+c*j,r[4]=o*A+a*N+l*U+c*J,r[8]=o*X+a*ee+l*q+c*te,r[12]=o*b+a*ue+l*Q+c*re,r[1]=h*R+u*w+f*I+g*j,r[5]=h*A+u*N+f*U+g*J,r[9]=h*X+u*ee+f*q+g*te,r[13]=h*b+u*ue+f*Q+g*re,r[2]=_*R+m*w+p*I+d*j,r[6]=_*A+m*N+p*U+d*J,r[10]=_*X+m*ee+p*q+d*te,r[14]=_*b+m*ue+p*Q+d*re,r[3]=M*R+v*w+T*I+P*j,r[7]=M*A+v*N+T*U+P*J,r[11]=M*X+v*ee+T*q+P*te,r[15]=M*b+v*ue+T*Q+P*re,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],l=e[9],c=e[13],h=e[2],u=e[6],f=e[10],g=e[14],_=e[3],m=e[7],p=e[11],d=e[15];return _*(+r*l*u-s*c*u-r*a*f+n*c*f+s*a*g-n*l*g)+m*(+t*l*g-t*c*f+r*o*f-s*o*g+s*c*h-r*l*h)+p*(+t*c*u-t*a*g-r*o*u+n*o*g+r*a*h-n*c*h)+d*(-s*a*h-t*l*u+t*a*f+s*o*u-n*o*f+n*l*h)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8],u=e[9],f=e[10],g=e[11],_=e[12],m=e[13],p=e[14],d=e[15],M=u*p*c-m*f*c+m*l*g-a*p*g-u*l*d+a*f*d,v=_*f*c-h*p*c-_*l*g+o*p*g+h*l*d-o*f*d,T=h*m*c-_*u*c+_*a*g-o*m*g-h*a*d+o*u*d,P=_*u*l-h*m*l-_*a*f+o*m*f+h*a*p-o*u*p,R=t*M+n*v+s*T+r*P;if(R===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let A=1/R;return e[0]=M*A,e[1]=(m*f*r-u*p*r-m*s*g+n*p*g+u*s*d-n*f*d)*A,e[2]=(a*p*r-m*l*r+m*s*c-n*p*c-a*s*d+n*l*d)*A,e[3]=(u*l*r-a*f*r-u*s*c+n*f*c+a*s*g-n*l*g)*A,e[4]=v*A,e[5]=(h*p*r-_*f*r+_*s*g-t*p*g-h*s*d+t*f*d)*A,e[6]=(_*l*r-o*p*r-_*s*c+t*p*c+o*s*d-t*l*d)*A,e[7]=(o*f*r-h*l*r+h*s*c-t*f*c-o*s*g+t*l*g)*A,e[8]=T*A,e[9]=(_*u*r-h*m*r-_*n*g+t*m*g+h*n*d-t*u*d)*A,e[10]=(o*m*r-_*a*r+_*n*c-t*m*c-o*n*d+t*a*d)*A,e[11]=(h*a*r-o*u*r-h*n*c+t*u*c+o*n*g-t*a*g)*A,e[12]=P*A,e[13]=(h*m*s-_*u*s+_*n*f-t*m*f-h*n*p+t*u*p)*A,e[14]=(_*a*s-o*m*s-_*n*l+t*m*l+o*n*p-t*a*p)*A,e[15]=(o*u*s-h*a*s+h*n*l-t*u*l-o*n*f+t*a*f)*A,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,l=e.z,c=r*o,h=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,h*a+n,h*l-s*o,0,c*l-s*a,h*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,o=t._y,a=t._z,l=t._w,c=r+r,h=o+o,u=a+a,f=r*c,g=r*h,_=r*u,m=o*h,p=o*u,d=a*u,M=l*c,v=l*h,T=l*u,P=n.x,R=n.y,A=n.z;return s[0]=(1-(m+d))*P,s[1]=(g+T)*P,s[2]=(_-v)*P,s[3]=0,s[4]=(g-T)*R,s[5]=(1-(f+d))*R,s[6]=(p+M)*R,s[7]=0,s[8]=(_+v)*A,s[9]=(p-M)*A,s[10]=(1-(f+m))*A,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements,r=mi.set(s[0],s[1],s[2]).length(),o=mi.set(s[4],s[5],s[6]).length(),a=mi.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],nn.copy(this);let c=1/r,h=1/o,u=1/a;return nn.elements[0]*=c,nn.elements[1]*=c,nn.elements[2]*=c,nn.elements[4]*=h,nn.elements[5]*=h,nn.elements[6]*=h,nn.elements[8]*=u,nn.elements[9]*=u,nn.elements[10]*=u,t.setFromRotationMatrix(nn),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=En){let l=this.elements,c=2*r/(t-e),h=2*r/(n-s),u=(t+e)/(t-e),f=(n+s)/(n-s),g,_;if(a===En)g=-(o+r)/(o-r),_=-2*o*r/(o-r);else if(a===Qs)g=-o/(o-r),_=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=u,l[12]=0,l[1]=0,l[5]=h,l[9]=f,l[13]=0,l[2]=0,l[6]=0,l[10]=g,l[14]=_,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=En){let l=this.elements,c=1/(t-e),h=1/(n-s),u=1/(o-r),f=(t+e)*c,g=(n+s)*h,_,m;if(a===En)_=(o+r)*u,m=-2*u;else if(a===Qs)_=r*u,m=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-f,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-g,l[2]=0,l[6]=0,l[10]=m,l[14]=-_,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},mi=new D,nn=new rt,Eu=new D(0,0,0),Tu=new D(1,1,1),Un=new D,Rs=new D,Gt=new D,Ml=new rt,bl=new an,rr=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],h=s[9],u=s[2],f=s[6],g=s[10];switch(t){case"XYZ":this._y=Math.asin(At(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,g),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-At(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,g),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(At(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-u,g),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-At(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(f,g),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(At(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(a,g));break;case"XZY":this._z=Math.asin(-At(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-h,g),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Ml.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Ml,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return bl.setFromEuler(this),this.setFromQuaternion(bl,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};rr.DEFAULT_ORDER="XYZ";var ar=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Au=0,Sl=new D,gi=new an,yn=new rt,Cs=new D,Ki=new D,Ru=new D,Cu=new an,wl=new D(1,0,0),El=new D(0,1,0),Tl=new D(0,0,1),Pu={type:"added"},Lu={type:"removed"},ht=class i extends fn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Au++}),this.uuid=Hi(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new D,t=new rr,n=new an,s=new D(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new rt},normalMatrix:{value:new Xe}}),this.matrix=new rt,this.matrixWorld=new rt,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ar,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return gi.setFromAxisAngle(e,t),this.quaternion.multiply(gi),this}rotateOnWorldAxis(e,t){return gi.setFromAxisAngle(e,t),this.quaternion.premultiply(gi),this}rotateX(e){return this.rotateOnAxis(wl,e)}rotateY(e){return this.rotateOnAxis(El,e)}rotateZ(e){return this.rotateOnAxis(Tl,e)}translateOnAxis(e,t){return Sl.copy(e).applyQuaternion(this.quaternion),this.position.add(Sl.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(wl,e)}translateY(e){return this.translateOnAxis(El,e)}translateZ(e){return this.translateOnAxis(Tl,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(yn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Cs.copy(e):Cs.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),Ki.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?yn.lookAt(Ki,Cs,this.up):yn.lookAt(Cs,Ki,this.up),this.quaternion.setFromRotationMatrix(yn),s&&(yn.extractRotation(s.matrixWorld),gi.setFromRotationMatrix(yn),this.quaternion.premultiply(gi.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.parent!==null&&e.parent.remove(e),e.parent=this,this.children.push(e),e.dispatchEvent(Pu)):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Lu)),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),yn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),yn.multiply(e.parent.matrixWorld)),e.applyMatrix4(yn),this.add(e),e.updateWorldMatrix(!1,!0),this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ki,e,Ru),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ki,Cu,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++){let r=t[n];(r.matrixWorldAutoUpdate===!0||e===!0)&&r.updateMatrixWorld(e)}}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.matrixWorldAutoUpdate===!0&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),t===!0){let s=this.children;for(let r=0,o=s.length;r<o;r++){let a=s[r];a.matrixWorldAutoUpdate===!0&&a.updateWorldMatrix(!1,!0)}}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxGeometryCount=this._maxGeometryCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let u=l[c];r(e.shapes,u)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(e.materials,this.material[l]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];s.animations.push(r(e.animations,l))}}if(t){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),h=o(e.images),u=o(e.shapes),f=o(e.skeletons),g=o(e.animations),_=o(e.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),f.length>0&&(n.skeletons=f),g.length>0&&(n.animations=g),_.length>0&&(n.nodes=_)}return n.object=s,n;function o(a){let l=[];for(let c in a){let h=a[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};ht.DEFAULT_UP=new D(0,1,0);ht.DEFAULT_MATRIX_AUTO_UPDATE=!0;ht.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var sn=new D,Mn=new D,ia=new D,bn=new D,_i=new D,xi=new D,Al=new D,sa=new D,ra=new D,aa=new D,Ps=!1,Ri=class i{constructor(e=new D,t=new D,n=new D){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),sn.subVectors(e,t),s.cross(sn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){sn.subVectors(s,t),Mn.subVectors(n,t),ia.subVectors(e,t);let o=sn.dot(sn),a=sn.dot(Mn),l=sn.dot(ia),c=Mn.dot(Mn),h=Mn.dot(ia),u=o*c-a*a;if(u===0)return r.set(0,0,0),null;let f=1/u,g=(c*l-a*h)*f,_=(o*h-a*l)*f;return r.set(1-g-_,_,g)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,bn)===null?!1:bn.x>=0&&bn.y>=0&&bn.x+bn.y<=1}static getUV(e,t,n,s,r,o,a,l){return Ps===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),Ps=!0),this.getInterpolation(e,t,n,s,r,o,a,l)}static getInterpolation(e,t,n,s,r,o,a,l){return this.getBarycoord(e,t,n,s,bn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,bn.x),l.addScaledVector(o,bn.y),l.addScaledVector(a,bn.z),l)}static isFrontFacing(e,t,n,s){return sn.subVectors(n,t),Mn.subVectors(e,t),sn.cross(Mn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return sn.subVectors(this.c,this.b),Mn.subVectors(this.a,this.b),sn.cross(Mn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getUV(e,t,n,s,r){return Ps===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),Ps=!0),i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,o,a;_i.subVectors(s,n),xi.subVectors(r,n),sa.subVectors(e,n);let l=_i.dot(sa),c=xi.dot(sa);if(l<=0&&c<=0)return t.copy(n);ra.subVectors(e,s);let h=_i.dot(ra),u=xi.dot(ra);if(h>=0&&u<=h)return t.copy(s);let f=l*u-h*c;if(f<=0&&l>=0&&h<=0)return o=l/(l-h),t.copy(n).addScaledVector(_i,o);aa.subVectors(e,r);let g=_i.dot(aa),_=xi.dot(aa);if(_>=0&&g<=_)return t.copy(r);let m=g*c-l*_;if(m<=0&&c>=0&&_<=0)return a=c/(c-_),t.copy(n).addScaledVector(xi,a);let p=h*_-g*u;if(p<=0&&u-h>=0&&g-_>=0)return Al.subVectors(r,s),a=(u-h)/(u-h+(g-_)),t.copy(s).addScaledVector(Al,a);let d=1/(p+m+f);return o=m*d,a=f*d,t.copy(n).addScaledVector(_i,o).addScaledVector(xi,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},wc={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Nn={h:0,s:0,l:0},Ls={h:0,s:0,l:0};function oa(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var Te=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Mt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,$e.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=$e.workingColorSpace){return this.r=e,this.g=t,this.b=n,$e.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=$e.workingColorSpace){if(e=ao(e,1),t=At(t,0,1),n=At(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=oa(o,r,e+1/3),this.g=oa(o,r,e),this.b=oa(o,r,e-1/3)}return $e.toWorkingColorSpace(this,s),this}setStyle(e,t=Mt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Mt){let n=wc[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Ii(e.r),this.g=Ii(e.g),this.b=Ii(e.b),this}copyLinearToSRGB(e){return this.r=Jr(e.r),this.g=Jr(e.g),this.b=Jr(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Mt){return $e.fromWorkingColorSpace(Tt.copy(this),e),Math.round(At(Tt.r*255,0,255))*65536+Math.round(At(Tt.g*255,0,255))*256+Math.round(At(Tt.b*255,0,255))}getHexString(e=Mt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=$e.workingColorSpace){$e.fromWorkingColorSpace(Tt.copy(this),t);let n=Tt.r,s=Tt.g,r=Tt.b,o=Math.max(n,s,r),a=Math.min(n,s,r),l,c,h=(a+o)/2;if(a===o)l=0,c=0;else{let u=o-a;switch(c=h<=.5?u/(o+a):u/(2-o-a),o){case n:l=(s-r)/u+(s<r?6:0);break;case s:l=(r-n)/u+2;break;case r:l=(n-s)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=$e.workingColorSpace){return $e.fromWorkingColorSpace(Tt.copy(this),t),e.r=Tt.r,e.g=Tt.g,e.b=Tt.b,e}getStyle(e=Mt){$e.fromWorkingColorSpace(Tt.copy(this),e);let t=Tt.r,n=Tt.g,s=Tt.b;return e!==Mt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Nn),this.setHSL(Nn.h+e,Nn.s+t,Nn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Nn),e.getHSL(Ls);let n=ns(Nn.h,Ls.h,t),s=ns(Nn.s,Ls.s,t),r=ns(Nn.l,Ls.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Tt=new Te;Te.NAMES=wc;var Iu=0,Gn=class extends fn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Iu++}),this.uuid=Hi(),this.name="",this.type="Material",this.blending=Li,this.side=Hn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=xa,this.blendDst=va,this.blendEquation=Qn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Te(0,0,0),this.blendAlpha=0,this.depthFunc=Ys,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=fl,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=hi,this.stencilZFail=hi,this.stencilZPass=hi,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBuild(){}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Li&&(n.blending=this.blending),this.side!==Hn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==xa&&(n.blendSrc=this.blendSrc),this.blendDst!==va&&(n.blendDst=this.blendDst),this.blendEquation!==Qn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Ys&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==fl&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==hi&&(n.stencilFail=this.stencilFail),this.stencilZFail!==hi&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==hi&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let o=[];for(let a in r){let l=r[a];delete l.metadata,o.push(l)}return o}if(t){let r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},or=class extends Gn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Te(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.combine=uc,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var lt=new D,Is=new De,xt=class{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=pl,this._updateRange={offset:0,count:-1},this.updateRanges=[],this.gpuType=On,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}get updateRange(){return console.warn("THREE.BufferAttribute: updateRange() is deprecated and will be removed in r169. Use addUpdateRange() instead."),this._updateRange}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Is.fromBufferAttribute(this,t),Is.applyMatrix3(e),this.setXY(t,Is.x,Is.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.applyMatrix3(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.applyMatrix4(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.applyNormalMatrix(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)lt.fromBufferAttribute(this,t),lt.transformDirection(e),this.setXYZ(t,lt.x,lt.y,lt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Ai(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Dt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ai(t,this.array)),t}setX(e,t){return this.normalized&&(t=Dt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ai(t,this.array)),t}setY(e,t){return this.normalized&&(t=Dt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ai(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Dt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ai(t,this.array)),t}setW(e,t){return this.normalized&&(t=Dt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Dt(t,this.array),n=Dt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Dt(t,this.array),n=Dt(n,this.array),s=Dt(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Dt(t,this.array),n=Dt(n,this.array),s=Dt(s,this.array),r=Dt(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==pl&&(e.usage=this.usage),e}};var lr=class extends xt{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var cr=class extends xt{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var ct=class extends xt{constructor(e,t,n){super(new Float32Array(e),t,n)}};var Du=0,$t=new rt,la=new ht,vi=new D,Wt=new Rn,ji=new Rn,gt=new D,Ot=class i extends fn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Du++}),this.uuid=Hi(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Sc(e)?cr:lr)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new Xe().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return $t.makeRotationFromQuaternion(e),this.applyMatrix4($t),this}rotateX(e){return $t.makeRotationX(e),this.applyMatrix4($t),this}rotateY(e){return $t.makeRotationY(e),this.applyMatrix4($t),this}rotateZ(e){return $t.makeRotationZ(e),this.applyMatrix4($t),this}translate(e,t,n){return $t.makeTranslation(e,t,n),this.applyMatrix4($t),this}scale(e,t,n){return $t.makeScale(e,t,n),this.applyMatrix4($t),this}lookAt(e){return la.lookAt(e),la.updateMatrix(),this.applyMatrix4(la.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(vi).negate(),this.translate(vi.x,vi.y,vi.z),this}setFromPoints(e){let t=[];for(let n=0,s=e.length;n<s;n++){let r=e[n];t.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new ct(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Rn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingBox.set(new D(-1/0,-1/0,-1/0),new D(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];Wt.setFromBufferAttribute(r),this.morphTargetsRelative?(gt.addVectors(this.boundingBox.min,Wt.min),this.boundingBox.expandByPoint(gt),gt.addVectors(this.boundingBox.max,Wt.max),this.boundingBox.expandByPoint(gt)):(this.boundingBox.expandByPoint(Wt.min),this.boundingBox.expandByPoint(Wt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Vn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingSphere.set(new D,1/0);return}if(e){let n=this.boundingSphere.center;if(Wt.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){let a=t[r];ji.setFromBufferAttribute(a),this.morphTargetsRelative?(gt.addVectors(Wt.min,ji.min),Wt.expandByPoint(gt),gt.addVectors(Wt.max,ji.max),Wt.expandByPoint(gt)):(Wt.expandByPoint(ji.min),Wt.expandByPoint(ji.max))}Wt.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)gt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(gt));if(t)for(let r=0,o=t.length;r<o;r++){let a=t[r],l=this.morphTargetsRelative;for(let c=0,h=a.count;c<h;c++)gt.fromBufferAttribute(a,c),l&&(vi.fromBufferAttribute(e,c),gt.add(vi)),s=Math.max(s,n.distanceToSquared(gt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=e.array,s=t.position.array,r=t.normal.array,o=t.uv.array,a=s.length/3;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new xt(new Float32Array(4*a),4));let l=this.getAttribute("tangent").array,c=[],h=[];for(let w=0;w<a;w++)c[w]=new D,h[w]=new D;let u=new D,f=new D,g=new D,_=new De,m=new De,p=new De,d=new D,M=new D;function v(w,N,ee){u.fromArray(s,w*3),f.fromArray(s,N*3),g.fromArray(s,ee*3),_.fromArray(o,w*2),m.fromArray(o,N*2),p.fromArray(o,ee*2),f.sub(u),g.sub(u),m.sub(_),p.sub(_);let ue=1/(m.x*p.y-p.x*m.y);isFinite(ue)&&(d.copy(f).multiplyScalar(p.y).addScaledVector(g,-m.y).multiplyScalar(ue),M.copy(g).multiplyScalar(m.x).addScaledVector(f,-p.x).multiplyScalar(ue),c[w].add(d),c[N].add(d),c[ee].add(d),h[w].add(M),h[N].add(M),h[ee].add(M))}let T=this.groups;T.length===0&&(T=[{start:0,count:n.length}]);for(let w=0,N=T.length;w<N;++w){let ee=T[w],ue=ee.start,I=ee.count;for(let U=ue,q=ue+I;U<q;U+=3)v(n[U+0],n[U+1],n[U+2])}let P=new D,R=new D,A=new D,X=new D;function b(w){A.fromArray(r,w*3),X.copy(A);let N=c[w];P.copy(N),P.sub(A.multiplyScalar(A.dot(N))).normalize(),R.crossVectors(X,N);let ue=R.dot(h[w])<0?-1:1;l[w*4]=P.x,l[w*4+1]=P.y,l[w*4+2]=P.z,l[w*4+3]=ue}for(let w=0,N=T.length;w<N;++w){let ee=T[w],ue=ee.start,I=ee.count;for(let U=ue,q=ue+I;U<q;U+=3)b(n[U+0]),b(n[U+1]),b(n[U+2])}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new xt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let f=0,g=n.count;f<g;f++)n.setXYZ(f,0,0,0);let s=new D,r=new D,o=new D,a=new D,l=new D,c=new D,h=new D,u=new D;if(e)for(let f=0,g=e.count;f<g;f+=3){let _=e.getX(f+0),m=e.getX(f+1),p=e.getX(f+2);s.fromBufferAttribute(t,_),r.fromBufferAttribute(t,m),o.fromBufferAttribute(t,p),h.subVectors(o,r),u.subVectors(s,r),h.cross(u),a.fromBufferAttribute(n,_),l.fromBufferAttribute(n,m),c.fromBufferAttribute(n,p),a.add(h),l.add(h),c.add(h),n.setXYZ(_,a.x,a.y,a.z),n.setXYZ(m,l.x,l.y,l.z),n.setXYZ(p,c.x,c.y,c.z)}else for(let f=0,g=t.count;f<g;f+=3)s.fromBufferAttribute(t,f+0),r.fromBufferAttribute(t,f+1),o.fromBufferAttribute(t,f+2),h.subVectors(o,r),u.subVectors(s,r),h.cross(u),n.setXYZ(f+0,h.x,h.y,h.z),n.setXYZ(f+1,h.x,h.y,h.z),n.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)gt.fromBufferAttribute(e,t),gt.normalize(),e.setXYZ(t,gt.x,gt.y,gt.z)}toNonIndexed(){function e(a,l){let c=a.array,h=a.itemSize,u=a.normalized,f=new c.constructor(l.length*h),g=0,_=0;for(let m=0,p=l.length;m<p;m++){a.isInterleavedBufferAttribute?g=l[m]*a.data.stride+a.offset:g=l[m]*h;for(let d=0;d<h;d++)f[_++]=c[g++]}return new xt(f,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let a in s){let l=s[a],c=e(l,n);t.setAttribute(a,c)}let r=this.morphAttributes;for(let a in r){let l=[],c=r[a];for(let h=0,u=c.length;h<u;h++){let f=c[h],g=e(f,n);l.push(g)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let u=0,f=c.length;u<f;u++){let g=c[u];h.push(g.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone(t));let s=e.attributes;for(let c in s){let h=s[c];this.setAttribute(c,h.clone(t))}let r=e.morphAttributes;for(let c in r){let h=[],u=r[c];for(let f=0,g=u.length;f<g;f++)h.push(u[f].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,h=o.length;c<h;c++){let u=o[c];this.addGroup(u.start,u.count,u.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},Rl=new rt,$n=new Oi,Ds=new Vn,Cl=new D,yi=new D,Mi=new D,bi=new D,ca=new D,Us=new D,Ns=new De,Fs=new De,Os=new De,Pl=new D,Ll=new D,Il=new D,Bs=new D,zs=new D,ot=class extends ht{constructor(e=new Ot,t=new or){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let a=this.morphTargetInfluences;if(r&&a){Us.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let h=a[l],u=r[l];h!==0&&(ca.fromBufferAttribute(u,e),o?Us.addScaledVector(ca,h):Us.addScaledVector(ca.sub(t),h))}t.add(Us)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Ds.copy(n.boundingSphere),Ds.applyMatrix4(r),$n.copy(e.ray).recast(e.near),!(Ds.containsPoint($n.origin)===!1&&($n.intersectSphere(Ds,Cl)===null||$n.origin.distanceToSquared(Cl)>(e.far-e.near)**2))&&(Rl.copy(r).invert(),$n.copy(e.ray).applyMatrix4(Rl),!(n.boundingBox!==null&&$n.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,$n)))}_computeIntersections(e,t,n){let s,r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,f=r.groups,g=r.drawRange;if(a!==null)if(Array.isArray(o))for(let _=0,m=f.length;_<m;_++){let p=f[_],d=o[p.materialIndex],M=Math.max(p.start,g.start),v=Math.min(a.count,Math.min(p.start+p.count,g.start+g.count));for(let T=M,P=v;T<P;T+=3){let R=a.getX(T),A=a.getX(T+1),X=a.getX(T+2);s=ks(this,d,e,n,c,h,u,R,A,X),s&&(s.faceIndex=Math.floor(T/3),s.face.materialIndex=p.materialIndex,t.push(s))}}else{let _=Math.max(0,g.start),m=Math.min(a.count,g.start+g.count);for(let p=_,d=m;p<d;p+=3){let M=a.getX(p),v=a.getX(p+1),T=a.getX(p+2);s=ks(this,o,e,n,c,h,u,M,v,T),s&&(s.faceIndex=Math.floor(p/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let _=0,m=f.length;_<m;_++){let p=f[_],d=o[p.materialIndex],M=Math.max(p.start,g.start),v=Math.min(l.count,Math.min(p.start+p.count,g.start+g.count));for(let T=M,P=v;T<P;T+=3){let R=T,A=T+1,X=T+2;s=ks(this,d,e,n,c,h,u,R,A,X),s&&(s.faceIndex=Math.floor(T/3),s.face.materialIndex=p.materialIndex,t.push(s))}}else{let _=Math.max(0,g.start),m=Math.min(l.count,g.start+g.count);for(let p=_,d=m;p<d;p+=3){let M=p,v=p+1,T=p+2;s=ks(this,o,e,n,c,h,u,M,v,T),s&&(s.faceIndex=Math.floor(p/3),t.push(s))}}}};function Uu(i,e,t,n,s,r,o,a){let l;if(e.side===Rt?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,e.side===Hn,a),l===null)return null;zs.copy(a),zs.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(zs);return c<t.near||c>t.far?null:{distance:c,point:zs.clone(),object:i}}function ks(i,e,t,n,s,r,o,a,l,c){i.getVertexPosition(a,yi),i.getVertexPosition(l,Mi),i.getVertexPosition(c,bi);let h=Uu(i,e,t,n,yi,Mi,bi,Bs);if(h){s&&(Ns.fromBufferAttribute(s,a),Fs.fromBufferAttribute(s,l),Os.fromBufferAttribute(s,c),h.uv=Ri.getInterpolation(Bs,yi,Mi,bi,Ns,Fs,Os,new De)),r&&(Ns.fromBufferAttribute(r,a),Fs.fromBufferAttribute(r,l),Os.fromBufferAttribute(r,c),h.uv1=Ri.getInterpolation(Bs,yi,Mi,bi,Ns,Fs,Os,new De),h.uv2=h.uv1),o&&(Pl.fromBufferAttribute(o,a),Ll.fromBufferAttribute(o,l),Il.fromBufferAttribute(o,c),h.normal=Ri.getInterpolation(Bs,yi,Mi,bi,Pl,Ll,Il,new D),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let u={a,b:l,c,normal:new D,materialIndex:0};Ri.getNormal(yi,Mi,bi,u.normal),h.face=u}return h}var si=class i extends Ot{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};let a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);let l=[],c=[],h=[],u=[],f=0,g=0;_("z","y","x",-1,-1,n,t,e,o,r,0),_("z","y","x",1,-1,n,t,-e,o,r,1),_("x","z","y",1,1,e,n,t,s,o,2),_("x","z","y",1,-1,e,n,-t,s,o,3),_("x","y","z",1,-1,e,t,n,s,r,4),_("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new ct(c,3)),this.setAttribute("normal",new ct(h,3)),this.setAttribute("uv",new ct(u,2));function _(m,p,d,M,v,T,P,R,A,X,b){let w=T/A,N=P/X,ee=T/2,ue=P/2,I=R/2,U=A+1,q=X+1,Q=0,j=0,J=new D;for(let te=0;te<q;te++){let re=te*N-ue;for(let fe=0;fe<U;fe++){let H=fe*w-ee;J[m]=H*M,J[p]=re*v,J[d]=I,c.push(J.x,J.y,J.z),J[m]=0,J[p]=0,J[d]=R>0?1:-1,h.push(J.x,J.y,J.z),u.push(fe/A),u.push(1-te/X),Q+=1}}for(let te=0;te<X;te++)for(let re=0;re<A;re++){let fe=f+re+U*te,H=f+re+U*(te+1),ne=f+(re+1)+U*(te+1),de=f+(re+1)+U*te;l.push(fe,H,de),l.push(H,ne,de),j+=6}a.addGroup(g,j,b),g+=j,f+=Q}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function Bi(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function Ut(i){let e={};for(let t=0;t<i.length;t++){let n=Bi(i[t]);for(let s in n)e[s]=n[s]}return e}function Nu(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Ec(i){return i.getRenderTarget()===null?i.outputColorSpace:$e.workingColorSpace}var oo={clone:Bi,merge:Ut},Fu=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Ou=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,on=class extends Gn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Fu,this.fragmentShader=Ou,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={derivatives:!1,fragDepth:!1,drawBuffers:!1,shaderTextureLOD:!1,clipCullDistance:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Bi(e.uniforms),this.uniformsGroups=Nu(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},hr=class extends ht{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new rt,this.projectionMatrix=new rt,this.projectionMatrixInverse=new rt,this.coordinateSystem=En}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},Ft=class extends hr{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=os*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(ts*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return os*2*Math.atan(Math.tan(ts*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(ts*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,t-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}let a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},Si=-90,wi=1,Ra=class extends ht{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new Ft(Si,wi,e,t);s.layers=this.layers,this.add(s);let r=new Ft(Si,wi,e,t);r.layers=this.layers,this.add(r);let o=new Ft(Si,wi,e,t);o.layers=this.layers,this.add(o);let a=new Ft(Si,wi,e,t);a.layers=this.layers,this.add(a);let l=new Ft(Si,wi,e,t);l.layers=this.layers,this.add(l);let c=new Ft(Si,wi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,l]=t;for(let c of t)this.remove(c);if(e===En)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Qs)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,o,a,l,c,h]=this.children,u=e.getRenderTarget(),f=e.getActiveCubeFace(),g=e.getActiveMipmapLevel(),_=e.xr.enabled;e.xr.enabled=!1;let m=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=m,e.setRenderTarget(n,5,s),e.render(t,h),e.setRenderTarget(u,f,g),e.xr.enabled=_,n.texture.needsPMREMUpdate=!0}},ur=class extends Qt{constructor(e,t,n,s,r,o,a,l,c,h){e=e!==void 0?e:[],t=t!==void 0?t:Ui,super(e,t,n,s,r,o,a,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Ca=class extends An{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];t.encoding!==void 0&&(is("THREE.WebGLCubeRenderTarget: option.encoding has been replaced by option.colorSpace."),t.colorSpace=t.encoding===ii?Mt:Kt),this.texture=new ur(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:Nt}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new si(5,5,5),r=new on({name:"CubemapFromEquirect",uniforms:Bi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Rt,blending:Bn});r.uniforms.tEquirect.value=t;let o=new ot(s,r),a=t.minFilter;return t.minFilter===rs&&(t.minFilter=Nt),new Ra(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,s){let r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}},ha=new D,Bu=new D,zu=new Xe,rn=class{constructor(e=new D(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=ha.subVectors(n,t).cross(Bu.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta(ha),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||zu.getNormalMatrix(e),s=this.coplanarPoint(ha).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Kn=new Vn,Hs=new D,ls=class{constructor(e=new rn,t=new rn,n=new rn,s=new rn,r=new rn,o=new rn){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){let a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=En){let n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],l=s[3],c=s[4],h=s[5],u=s[6],f=s[7],g=s[8],_=s[9],m=s[10],p=s[11],d=s[12],M=s[13],v=s[14],T=s[15];if(n[0].setComponents(l-r,f-c,p-g,T-d).normalize(),n[1].setComponents(l+r,f+c,p+g,T+d).normalize(),n[2].setComponents(l+o,f+h,p+_,T+M).normalize(),n[3].setComponents(l-o,f-h,p-_,T-M).normalize(),n[4].setComponents(l-a,f-u,p-m,T-v).normalize(),t===En)n[5].setComponents(l+a,f+u,p+m,T+v).normalize();else if(t===Qs)n[5].setComponents(a,u,m,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Kn.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Kn.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Kn)}intersectsSprite(e){return Kn.center.set(0,0,0),Kn.radius=.7071067811865476,Kn.applyMatrix4(e.matrixWorld),this.intersectsSphere(Kn)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(Hs.x=s.normal.x>0?e.max.x:e.min.x,Hs.y=s.normal.y>0?e.max.y:e.min.y,Hs.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Hs)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};function Tc(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function ku(i,e){let t=e.isWebGL2,n=new WeakMap;function s(c,h){let u=c.array,f=c.usage,g=u.byteLength,_=i.createBuffer();i.bindBuffer(h,_),i.bufferData(h,u,f),c.onUploadCallback();let m;if(u instanceof Float32Array)m=i.FLOAT;else if(u instanceof Uint16Array)if(c.isFloat16BufferAttribute)if(t)m=i.HALF_FLOAT;else throw new Error("THREE.WebGLAttributes: Usage of Float16BufferAttribute requires WebGL2.");else m=i.UNSIGNED_SHORT;else if(u instanceof Int16Array)m=i.SHORT;else if(u instanceof Uint32Array)m=i.UNSIGNED_INT;else if(u instanceof Int32Array)m=i.INT;else if(u instanceof Int8Array)m=i.BYTE;else if(u instanceof Uint8Array)m=i.UNSIGNED_BYTE;else if(u instanceof Uint8ClampedArray)m=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+u);return{buffer:_,type:m,bytesPerElement:u.BYTES_PER_ELEMENT,version:c.version,size:g}}function r(c,h,u){let f=h.array,g=h._updateRange,_=h.updateRanges;if(i.bindBuffer(u,c),g.count===-1&&_.length===0&&i.bufferSubData(u,0,f),_.length!==0){for(let m=0,p=_.length;m<p;m++){let d=_[m];t?i.bufferSubData(u,d.start*f.BYTES_PER_ELEMENT,f,d.start,d.count):i.bufferSubData(u,d.start*f.BYTES_PER_ELEMENT,f.subarray(d.start,d.start+d.count))}h.clearUpdateRanges()}g.count!==-1&&(t?i.bufferSubData(u,g.offset*f.BYTES_PER_ELEMENT,f,g.offset,g.count):i.bufferSubData(u,g.offset*f.BYTES_PER_ELEMENT,f.subarray(g.offset,g.offset+g.count)),g.count=-1),h.onUploadCallback()}function o(c){return c.isInterleavedBufferAttribute&&(c=c.data),n.get(c)}function a(c){c.isInterleavedBufferAttribute&&(c=c.data);let h=n.get(c);h&&(i.deleteBuffer(h.buffer),n.delete(c))}function l(c,h){if(c.isGLBufferAttribute){let f=n.get(c);(!f||f.version<c.version)&&n.set(c,{buffer:c.buffer,type:c.type,bytesPerElement:c.elementSize,version:c.version});return}c.isInterleavedBufferAttribute&&(c=c.data);let u=n.get(c);if(u===void 0)n.set(c,s(c,h));else if(u.version<c.version){if(u.size!==c.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");r(u.buffer,c,h),u.version=c.version}}return{get:o,remove:a,update:l}}var zi=class i extends Ot{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,o=t/2,a=Math.floor(n),l=Math.floor(s),c=a+1,h=l+1,u=e/a,f=t/l,g=[],_=[],m=[],p=[];for(let d=0;d<h;d++){let M=d*f-o;for(let v=0;v<c;v++){let T=v*u-r;_.push(T,-M,0),m.push(0,0,1),p.push(v/a),p.push(1-d/l)}}for(let d=0;d<l;d++)for(let M=0;M<a;M++){let v=M+c*d,T=M+c*(d+1),P=M+1+c*(d+1),R=M+1+c*d;g.push(v,T,R),g.push(T,P,R)}this.setIndex(g),this.setAttribute("position",new ct(_,3)),this.setAttribute("normal",new ct(m,3)),this.setAttribute("uv",new ct(p,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}},Hu=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Vu=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Gu=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Wu=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Xu=`#ifdef USE_ALPHATEST
	if ( diffuseColor.a < alphaTest ) discard;
#endif`,qu=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Yu=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Zu=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Ju=`#ifdef USE_BATCHING
	attribute float batchId;
	uniform highp sampler2D batchingTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,$u=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( batchId );
#endif`,Ku=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,ju=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Qu=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,ed=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,td=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,nd=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#pragma unroll_loop_start
	for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
		plane = clippingPlanes[ i ];
		if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
	}
	#pragma unroll_loop_end
	#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
		bool clipped = true;
		#pragma unroll_loop_start
		for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
		}
		#pragma unroll_loop_end
		if ( clipped ) discard;
	#endif
#endif`,id=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,sd=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,rd=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,ad=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,od=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,ld=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	varying vec3 vColor;
#endif`,cd=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif`,hd=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
float luminance( const in vec3 rgb ) {
	const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 );
	return dot( weights, rgb );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,ud=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,dd=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,fd=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,pd=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,md=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,gd=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,_d="gl_FragColor = linearToOutputTexel( gl_FragColor );",xd=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 LinearTosRGB( in vec4 value ) {
	return sRGBTransferOETF( value );
}`,vd=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,yd=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Md=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,bd=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Sd=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,wd=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Ed=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Td=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Ad=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Rd=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Cd=`#ifdef USE_LIGHTMAP
	vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
	vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
	reflectedLight.indirectDiffuse += lightMapIrradiance;
#endif`,Pd=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Ld=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Id=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Dd=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	#if defined ( LEGACY_LIGHTS )
		if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {
			return pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );
		}
		return 1.0;
	#else
		float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
		if ( cutoffDistance > 0.0 ) {
			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
		}
		return distanceFalloff;
	#endif
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Ud=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Nd=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Fd=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Od=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Bd=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,zd=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,kd=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Hd=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Vd=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Gd=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Wd=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	gl_FragDepthEXT = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Xd=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,qd=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		varying float vFragDepth;
		varying float vIsPerspective;
	#else
		uniform float logDepthBufFC;
	#endif
#endif`,Yd=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		vFragDepth = 1.0 + gl_Position.w;
		vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
	#else
		if ( isPerspectiveMatrix( projectionMatrix ) ) {
			gl_Position.z = log2( max( EPSILON, gl_Position.w + 1.0 ) ) * logDepthBufFC - 1.0;
			gl_Position.z *= gl_Position.w;
		}
	#endif
#endif`,Zd=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Jd=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,$d=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Kd=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,jd=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Qd=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,ef=`#if defined( USE_MORPHCOLORS ) && defined( MORPHTARGETS_TEXTURE )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,tf=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];
		objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];
		objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];
		objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];
	#endif
#endif`,nf=`#ifdef USE_MORPHTARGETS
	uniform float morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
		uniform sampler2DArray morphTargetsTexture;
		uniform ivec2 morphTargetsTextureSize;
		vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
			int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
			int y = texelIndex / morphTargetsTextureSize.x;
			int x = texelIndex - y * morphTargetsTextureSize.x;
			ivec3 morphUV = ivec3( x, y, morphTargetIndex );
			return texelFetch( morphTargetsTexture, morphUV, 0 );
		}
	#else
		#ifndef USE_MORPHNORMALS
			uniform float morphTargetInfluences[ 8 ];
		#else
			uniform float morphTargetInfluences[ 4 ];
		#endif
	#endif
#endif`,sf=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		transformed += morphTarget0 * morphTargetInfluences[ 0 ];
		transformed += morphTarget1 * morphTargetInfluences[ 1 ];
		transformed += morphTarget2 * morphTargetInfluences[ 2 ];
		transformed += morphTarget3 * morphTargetInfluences[ 3 ];
		#ifndef USE_MORPHNORMALS
			transformed += morphTarget4 * morphTargetInfluences[ 4 ];
			transformed += morphTarget5 * morphTargetInfluences[ 5 ];
			transformed += morphTarget6 * morphTargetInfluences[ 6 ];
			transformed += morphTarget7 * morphTargetInfluences[ 7 ];
		#endif
	#endif
#endif`,rf=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,af=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,of=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,lf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,cf=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,hf=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,uf=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,df=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,ff=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,pf=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,mf=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,gf=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;
const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );
const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );
const float ShiftRight8 = 1. / 256.;
vec4 packDepthToRGBA( const in float v ) {
	vec4 r = vec4( fract( v * PackFactors ), v );
	r.yzw -= r.xyz * ShiftRight8;	return r * PackUpscale;
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors );
}
vec2 packDepthToRG( in highp float v ) {
	return packDepthToRGBA( v ).yx;
}
float unpackRGToDepth( const in highp vec2 v ) {
	return unpackRGBAToDepth( vec4( v.xy, 0.0, 0.0 ) );
}
vec4 pack2HalfToRGBA( vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,_f=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,xf=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,vf=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,yf=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Mf=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,bf=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Sf=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return shadow;
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
		vec3 lightToPosition = shadowCoord.xyz;
		float dp = ( length( lightToPosition ) - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );		dp += shadowBias;
		vec3 bd3D = normalize( lightToPosition );
		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
			vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
			return (
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
			) * ( 1.0 / 9.0 );
		#else
			return texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
		#endif
	}
#endif`,wf=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Ef=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Tf=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Af=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Rf=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Cf=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Pf=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Lf=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,If=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Df=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Uf=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 OptimizedCineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color *= toneMappingExposure;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	return color;
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Nf=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Ff=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
		vec3 refractedRayExit = position + transmissionRay;
		vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
		vec2 refractionCoords = ndcPos.xy / ndcPos.w;
		refractionCoords += 1.0;
		refractionCoords /= 2.0;
		vec4 transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
		vec3 transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Of=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Bf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,zf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,kf=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Hf=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Vf=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Gf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Wf=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Xf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,qf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Yf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Zf=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#endif
}`,Jf=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,$f=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Kf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,jf=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Qf=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,ep=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,tp=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,np=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ip=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,sp=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,rp=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,ap=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,op=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,lp=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), opacity );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,cp=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,hp=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,up=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,dp=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,fp=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,pp=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,mp=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,gp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,_p=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,xp=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,vp=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec2 scale;
	scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
	scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,yp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ve={alphahash_fragment:Hu,alphahash_pars_fragment:Vu,alphamap_fragment:Gu,alphamap_pars_fragment:Wu,alphatest_fragment:Xu,alphatest_pars_fragment:qu,aomap_fragment:Yu,aomap_pars_fragment:Zu,batching_pars_vertex:Ju,batching_vertex:$u,begin_vertex:Ku,beginnormal_vertex:ju,bsdfs:Qu,iridescence_fragment:ed,bumpmap_pars_fragment:td,clipping_planes_fragment:nd,clipping_planes_pars_fragment:id,clipping_planes_pars_vertex:sd,clipping_planes_vertex:rd,color_fragment:ad,color_pars_fragment:od,color_pars_vertex:ld,color_vertex:cd,common:hd,cube_uv_reflection_fragment:ud,defaultnormal_vertex:dd,displacementmap_pars_vertex:fd,displacementmap_vertex:pd,emissivemap_fragment:md,emissivemap_pars_fragment:gd,colorspace_fragment:_d,colorspace_pars_fragment:xd,envmap_fragment:vd,envmap_common_pars_fragment:yd,envmap_pars_fragment:Md,envmap_pars_vertex:bd,envmap_physical_pars_fragment:Ud,envmap_vertex:Sd,fog_vertex:wd,fog_pars_vertex:Ed,fog_fragment:Td,fog_pars_fragment:Ad,gradientmap_pars_fragment:Rd,lightmap_fragment:Cd,lightmap_pars_fragment:Pd,lights_lambert_fragment:Ld,lights_lambert_pars_fragment:Id,lights_pars_begin:Dd,lights_toon_fragment:Nd,lights_toon_pars_fragment:Fd,lights_phong_fragment:Od,lights_phong_pars_fragment:Bd,lights_physical_fragment:zd,lights_physical_pars_fragment:kd,lights_fragment_begin:Hd,lights_fragment_maps:Vd,lights_fragment_end:Gd,logdepthbuf_fragment:Wd,logdepthbuf_pars_fragment:Xd,logdepthbuf_pars_vertex:qd,logdepthbuf_vertex:Yd,map_fragment:Zd,map_pars_fragment:Jd,map_particle_fragment:$d,map_particle_pars_fragment:Kd,metalnessmap_fragment:jd,metalnessmap_pars_fragment:Qd,morphcolor_vertex:ef,morphnormal_vertex:tf,morphtarget_pars_vertex:nf,morphtarget_vertex:sf,normal_fragment_begin:rf,normal_fragment_maps:af,normal_pars_fragment:of,normal_pars_vertex:lf,normal_vertex:cf,normalmap_pars_fragment:hf,clearcoat_normal_fragment_begin:uf,clearcoat_normal_fragment_maps:df,clearcoat_pars_fragment:ff,iridescence_pars_fragment:pf,opaque_fragment:mf,packing:gf,premultiplied_alpha_fragment:_f,project_vertex:xf,dithering_fragment:vf,dithering_pars_fragment:yf,roughnessmap_fragment:Mf,roughnessmap_pars_fragment:bf,shadowmap_pars_fragment:Sf,shadowmap_pars_vertex:wf,shadowmap_vertex:Ef,shadowmask_pars_fragment:Tf,skinbase_vertex:Af,skinning_pars_vertex:Rf,skinning_vertex:Cf,skinnormal_vertex:Pf,specularmap_fragment:Lf,specularmap_pars_fragment:If,tonemapping_fragment:Df,tonemapping_pars_fragment:Uf,transmission_fragment:Nf,transmission_pars_fragment:Ff,uv_pars_fragment:Of,uv_pars_vertex:Bf,uv_vertex:zf,worldpos_vertex:kf,background_vert:Hf,background_frag:Vf,backgroundCube_vert:Gf,backgroundCube_frag:Wf,cube_vert:Xf,cube_frag:qf,depth_vert:Yf,depth_frag:Zf,distanceRGBA_vert:Jf,distanceRGBA_frag:$f,equirect_vert:Kf,equirect_frag:jf,linedashed_vert:Qf,linedashed_frag:ep,meshbasic_vert:tp,meshbasic_frag:np,meshlambert_vert:ip,meshlambert_frag:sp,meshmatcap_vert:rp,meshmatcap_frag:ap,meshnormal_vert:op,meshnormal_frag:lp,meshphong_vert:cp,meshphong_frag:hp,meshphysical_vert:up,meshphysical_frag:dp,meshtoon_vert:fp,meshtoon_frag:pp,points_vert:mp,points_frag:gp,shadow_vert:_p,shadow_frag:xp,sprite_vert:vp,sprite_frag:yp},me={common:{diffuse:{value:new Te(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Xe},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Xe}},envmap:{envMap:{value:null},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Xe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Xe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Xe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Xe},normalScale:{value:new De(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Xe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Xe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Xe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Xe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Te(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Te(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0},uvTransform:{value:new Xe}},sprite:{diffuse:{value:new Te(16777215)},opacity:{value:1},center:{value:new De(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Xe},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0}}},dn={basic:{uniforms:Ut([me.common,me.specularmap,me.envmap,me.aomap,me.lightmap,me.fog]),vertexShader:Ve.meshbasic_vert,fragmentShader:Ve.meshbasic_frag},lambert:{uniforms:Ut([me.common,me.specularmap,me.envmap,me.aomap,me.lightmap,me.emissivemap,me.bumpmap,me.normalmap,me.displacementmap,me.fog,me.lights,{emissive:{value:new Te(0)}}]),vertexShader:Ve.meshlambert_vert,fragmentShader:Ve.meshlambert_frag},phong:{uniforms:Ut([me.common,me.specularmap,me.envmap,me.aomap,me.lightmap,me.emissivemap,me.bumpmap,me.normalmap,me.displacementmap,me.fog,me.lights,{emissive:{value:new Te(0)},specular:{value:new Te(1118481)},shininess:{value:30}}]),vertexShader:Ve.meshphong_vert,fragmentShader:Ve.meshphong_frag},standard:{uniforms:Ut([me.common,me.envmap,me.aomap,me.lightmap,me.emissivemap,me.bumpmap,me.normalmap,me.displacementmap,me.roughnessmap,me.metalnessmap,me.fog,me.lights,{emissive:{value:new Te(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ve.meshphysical_vert,fragmentShader:Ve.meshphysical_frag},toon:{uniforms:Ut([me.common,me.aomap,me.lightmap,me.emissivemap,me.bumpmap,me.normalmap,me.displacementmap,me.gradientmap,me.fog,me.lights,{emissive:{value:new Te(0)}}]),vertexShader:Ve.meshtoon_vert,fragmentShader:Ve.meshtoon_frag},matcap:{uniforms:Ut([me.common,me.bumpmap,me.normalmap,me.displacementmap,me.fog,{matcap:{value:null}}]),vertexShader:Ve.meshmatcap_vert,fragmentShader:Ve.meshmatcap_frag},points:{uniforms:Ut([me.points,me.fog]),vertexShader:Ve.points_vert,fragmentShader:Ve.points_frag},dashed:{uniforms:Ut([me.common,me.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ve.linedashed_vert,fragmentShader:Ve.linedashed_frag},depth:{uniforms:Ut([me.common,me.displacementmap]),vertexShader:Ve.depth_vert,fragmentShader:Ve.depth_frag},normal:{uniforms:Ut([me.common,me.bumpmap,me.normalmap,me.displacementmap,{opacity:{value:1}}]),vertexShader:Ve.meshnormal_vert,fragmentShader:Ve.meshnormal_frag},sprite:{uniforms:Ut([me.sprite,me.fog]),vertexShader:Ve.sprite_vert,fragmentShader:Ve.sprite_frag},background:{uniforms:{uvTransform:{value:new Xe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ve.background_vert,fragmentShader:Ve.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1}},vertexShader:Ve.backgroundCube_vert,fragmentShader:Ve.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ve.cube_vert,fragmentShader:Ve.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ve.equirect_vert,fragmentShader:Ve.equirect_frag},distanceRGBA:{uniforms:Ut([me.common,me.displacementmap,{referencePosition:{value:new D},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ve.distanceRGBA_vert,fragmentShader:Ve.distanceRGBA_frag},shadow:{uniforms:Ut([me.lights,me.fog,{color:{value:new Te(0)},opacity:{value:1}}]),vertexShader:Ve.shadow_vert,fragmentShader:Ve.shadow_frag}};dn.physical={uniforms:Ut([dn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Xe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Xe},clearcoatNormalScale:{value:new De(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Xe},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Xe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Xe},sheen:{value:0},sheenColor:{value:new Te(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Xe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Xe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Xe},transmissionSamplerSize:{value:new De},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Xe},attenuationDistance:{value:0},attenuationColor:{value:new Te(0)},specularColor:{value:new Te(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Xe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Xe},anisotropyVector:{value:new De},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Xe}}]),vertexShader:Ve.meshphysical_vert,fragmentShader:Ve.meshphysical_frag};var Vs={r:0,b:0,g:0};function Mp(i,e,t,n,s,r,o){let a=new Te(0),l=r===!0?0:1,c,h,u=null,f=0,g=null;function _(p,d){let M=!1,v=d.isScene===!0?d.background:null;v&&v.isTexture&&(v=(d.backgroundBlurriness>0?t:e).get(v)),v===null?m(a,l):v&&v.isColor&&(m(v,1),M=!0);let T=i.xr.getEnvironmentBlendMode();T==="additive"?n.buffers.color.setClear(0,0,0,1,o):T==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||M)&&i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil),v&&(v.isCubeTexture||v.mapping===Tr)?(h===void 0&&(h=new ot(new si(1,1,1),new on({name:"BackgroundCubeMaterial",uniforms:Bi(dn.backgroundCube.uniforms),vertexShader:dn.backgroundCube.vertexShader,fragmentShader:dn.backgroundCube.fragmentShader,side:Rt,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(P,R,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),h.material.uniforms.envMap.value=v,h.material.uniforms.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=d.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=d.backgroundIntensity,h.material.toneMapped=$e.getTransfer(v.colorSpace)!==et,(u!==v||f!==v.version||g!==i.toneMapping)&&(h.material.needsUpdate=!0,u=v,f=v.version,g=i.toneMapping),h.layers.enableAll(),p.unshift(h,h.geometry,h.material,0,0,null)):v&&v.isTexture&&(c===void 0&&(c=new ot(new zi(2,2),new on({name:"BackgroundMaterial",uniforms:Bi(dn.background.uniforms),vertexShader:dn.background.vertexShader,fragmentShader:dn.background.fragmentShader,side:Hn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=v,c.material.uniforms.backgroundIntensity.value=d.backgroundIntensity,c.material.toneMapped=$e.getTransfer(v.colorSpace)!==et,v.matrixAutoUpdate===!0&&v.updateMatrix(),c.material.uniforms.uvTransform.value.copy(v.matrix),(u!==v||f!==v.version||g!==i.toneMapping)&&(c.material.needsUpdate=!0,u=v,f=v.version,g=i.toneMapping),c.layers.enableAll(),p.unshift(c,c.geometry,c.material,0,0,null))}function m(p,d){p.getRGB(Vs,Ec(i)),n.buffers.color.setClear(Vs.r,Vs.g,Vs.b,d,o)}return{getClearColor:function(){return a},setClearColor:function(p,d=1){a.set(p),l=d,m(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(p){l=p,m(a,l)},render:_}}function bp(i,e,t,n){let s=i.getParameter(i.MAX_VERTEX_ATTRIBS),r=n.isWebGL2?null:e.get("OES_vertex_array_object"),o=n.isWebGL2||r!==null,a={},l=p(null),c=l,h=!1;function u(I,U,q,Q,j){let J=!1;if(o){let te=m(Q,q,U);c!==te&&(c=te,g(c.object)),J=d(I,Q,q,j),J&&M(I,Q,q,j)}else{let te=U.wireframe===!0;(c.geometry!==Q.id||c.program!==q.id||c.wireframe!==te)&&(c.geometry=Q.id,c.program=q.id,c.wireframe=te,J=!0)}j!==null&&t.update(j,i.ELEMENT_ARRAY_BUFFER),(J||h)&&(h=!1,X(I,U,q,Q),j!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(j).buffer))}function f(){return n.isWebGL2?i.createVertexArray():r.createVertexArrayOES()}function g(I){return n.isWebGL2?i.bindVertexArray(I):r.bindVertexArrayOES(I)}function _(I){return n.isWebGL2?i.deleteVertexArray(I):r.deleteVertexArrayOES(I)}function m(I,U,q){let Q=q.wireframe===!0,j=a[I.id];j===void 0&&(j={},a[I.id]=j);let J=j[U.id];J===void 0&&(J={},j[U.id]=J);let te=J[Q];return te===void 0&&(te=p(f()),J[Q]=te),te}function p(I){let U=[],q=[],Q=[];for(let j=0;j<s;j++)U[j]=0,q[j]=0,Q[j]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:U,enabledAttributes:q,attributeDivisors:Q,object:I,attributes:{},index:null}}function d(I,U,q,Q){let j=c.attributes,J=U.attributes,te=0,re=q.getAttributes();for(let fe in re)if(re[fe].location>=0){let ne=j[fe],de=J[fe];if(de===void 0&&(fe==="instanceMatrix"&&I.instanceMatrix&&(de=I.instanceMatrix),fe==="instanceColor"&&I.instanceColor&&(de=I.instanceColor)),ne===void 0||ne.attribute!==de||de&&ne.data!==de.data)return!0;te++}return c.attributesNum!==te||c.index!==Q}function M(I,U,q,Q){let j={},J=U.attributes,te=0,re=q.getAttributes();for(let fe in re)if(re[fe].location>=0){let ne=J[fe];ne===void 0&&(fe==="instanceMatrix"&&I.instanceMatrix&&(ne=I.instanceMatrix),fe==="instanceColor"&&I.instanceColor&&(ne=I.instanceColor));let de={};de.attribute=ne,ne&&ne.data&&(de.data=ne.data),j[fe]=de,te++}c.attributes=j,c.attributesNum=te,c.index=Q}function v(){let I=c.newAttributes;for(let U=0,q=I.length;U<q;U++)I[U]=0}function T(I){P(I,0)}function P(I,U){let q=c.newAttributes,Q=c.enabledAttributes,j=c.attributeDivisors;q[I]=1,Q[I]===0&&(i.enableVertexAttribArray(I),Q[I]=1),j[I]!==U&&((n.isWebGL2?i:e.get("ANGLE_instanced_arrays"))[n.isWebGL2?"vertexAttribDivisor":"vertexAttribDivisorANGLE"](I,U),j[I]=U)}function R(){let I=c.newAttributes,U=c.enabledAttributes;for(let q=0,Q=U.length;q<Q;q++)U[q]!==I[q]&&(i.disableVertexAttribArray(q),U[q]=0)}function A(I,U,q,Q,j,J,te){te===!0?i.vertexAttribIPointer(I,U,q,j,J):i.vertexAttribPointer(I,U,q,Q,j,J)}function X(I,U,q,Q){if(n.isWebGL2===!1&&(I.isInstancedMesh||Q.isInstancedBufferGeometry)&&e.get("ANGLE_instanced_arrays")===null)return;v();let j=Q.attributes,J=q.getAttributes(),te=U.defaultAttributeValues;for(let re in J){let fe=J[re];if(fe.location>=0){let H=j[re];if(H===void 0&&(re==="instanceMatrix"&&I.instanceMatrix&&(H=I.instanceMatrix),re==="instanceColor"&&I.instanceColor&&(H=I.instanceColor)),H!==void 0){let ne=H.normalized,de=H.itemSize,ge=t.get(H);if(ge===void 0)continue;let ye=ge.buffer,Le=ge.type,Ie=ge.bytesPerElement,Ee=n.isWebGL2===!0&&(Le===i.INT||Le===i.UNSIGNED_INT||H.gpuType===fc);if(H.isInterleavedBufferAttribute){let ke=H.data,O=ke.stride,Ke=H.offset;if(ke.isInstancedInterleavedBuffer){for(let be=0;be<fe.locationSize;be++)P(fe.location+be,ke.meshPerAttribute);I.isInstancedMesh!==!0&&Q._maxInstanceCount===void 0&&(Q._maxInstanceCount=ke.meshPerAttribute*ke.count)}else for(let be=0;be<fe.locationSize;be++)T(fe.location+be);i.bindBuffer(i.ARRAY_BUFFER,ye);for(let be=0;be<fe.locationSize;be++)A(fe.location+be,de/fe.locationSize,Le,ne,O*Ie,(Ke+de/fe.locationSize*be)*Ie,Ee)}else{if(H.isInstancedBufferAttribute){for(let ke=0;ke<fe.locationSize;ke++)P(fe.location+ke,H.meshPerAttribute);I.isInstancedMesh!==!0&&Q._maxInstanceCount===void 0&&(Q._maxInstanceCount=H.meshPerAttribute*H.count)}else for(let ke=0;ke<fe.locationSize;ke++)T(fe.location+ke);i.bindBuffer(i.ARRAY_BUFFER,ye);for(let ke=0;ke<fe.locationSize;ke++)A(fe.location+ke,de/fe.locationSize,Le,ne,de*Ie,de/fe.locationSize*ke*Ie,Ee)}}else if(te!==void 0){let ne=te[re];if(ne!==void 0)switch(ne.length){case 2:i.vertexAttrib2fv(fe.location,ne);break;case 3:i.vertexAttrib3fv(fe.location,ne);break;case 4:i.vertexAttrib4fv(fe.location,ne);break;default:i.vertexAttrib1fv(fe.location,ne)}}}}R()}function b(){ee();for(let I in a){let U=a[I];for(let q in U){let Q=U[q];for(let j in Q)_(Q[j].object),delete Q[j];delete U[q]}delete a[I]}}function w(I){if(a[I.id]===void 0)return;let U=a[I.id];for(let q in U){let Q=U[q];for(let j in Q)_(Q[j].object),delete Q[j];delete U[q]}delete a[I.id]}function N(I){for(let U in a){let q=a[U];if(q[I.id]===void 0)continue;let Q=q[I.id];for(let j in Q)_(Q[j].object),delete Q[j];delete q[I.id]}}function ee(){ue(),h=!0,c!==l&&(c=l,g(c.object))}function ue(){l.geometry=null,l.program=null,l.wireframe=!1}return{setup:u,reset:ee,resetDefaultState:ue,dispose:b,releaseStatesOfGeometry:w,releaseStatesOfProgram:N,initAttributes:v,enableAttribute:T,disableUnusedAttributes:R}}function Sp(i,e,t,n){let s=n.isWebGL2,r;function o(h){r=h}function a(h,u){i.drawArrays(r,h,u),t.update(u,r,1)}function l(h,u,f){if(f===0)return;let g,_;if(s)g=i,_="drawArraysInstanced";else if(g=e.get("ANGLE_instanced_arrays"),_="drawArraysInstancedANGLE",g===null){console.error("THREE.WebGLBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}g[_](r,h,u,f),t.update(u,r,f)}function c(h,u,f){if(f===0)return;let g=e.get("WEBGL_multi_draw");if(g===null)for(let _=0;_<f;_++)this.render(h[_],u[_]);else{g.multiDrawArraysWEBGL(r,h,0,u,0,f);let _=0;for(let m=0;m<f;m++)_+=u[m];t.update(_,r,1)}}this.setMode=o,this.render=a,this.renderInstances=l,this.renderMultiDraw=c}function wp(i,e,t){let n;function s(){if(n!==void 0)return n;if(e.has("EXT_texture_filter_anisotropic")===!0){let A=e.get("EXT_texture_filter_anisotropic");n=i.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function r(A){if(A==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let o=typeof WebGL2RenderingContext<"u"&&i.constructor.name==="WebGL2RenderingContext",a=t.precision!==void 0?t.precision:"highp",l=r(a);l!==a&&(console.warn("THREE.WebGLRenderer:",a,"not supported, using",l,"instead."),a=l);let c=o||e.has("WEBGL_draw_buffers"),h=t.logarithmicDepthBuffer===!0,u=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),f=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_TEXTURE_SIZE),_=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),m=i.getParameter(i.MAX_VERTEX_ATTRIBS),p=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),d=i.getParameter(i.MAX_VARYING_VECTORS),M=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),v=f>0,T=o||e.has("OES_texture_float"),P=v&&T,R=o?i.getParameter(i.MAX_SAMPLES):0;return{isWebGL2:o,drawBuffers:c,getMaxAnisotropy:s,getMaxPrecision:r,precision:a,logarithmicDepthBuffer:h,maxTextures:u,maxVertexTextures:f,maxTextureSize:g,maxCubemapSize:_,maxAttributes:m,maxVertexUniforms:p,maxVaryings:d,maxFragmentUniforms:M,vertexTextures:v,floatFragmentTextures:T,floatVertexTextures:P,maxSamples:R}}function Ep(i){let e=this,t=null,n=0,s=!1,r=!1,o=new rn,a=new Xe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,f){let g=u.length!==0||f||n!==0||s;return s=f,n=u.length,g},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,f){t=h(u,f,0)},this.setState=function(u,f,g){let _=u.clippingPlanes,m=u.clipIntersection,p=u.clipShadows,d=i.get(u);if(!s||_===null||_.length===0||r&&!p)r?h(null):c();else{let M=r?0:n,v=M*4,T=d.clippingState||null;l.value=T,T=h(_,f,v,g);for(let P=0;P!==v;++P)T[P]=t[P];d.clippingState=T,this.numIntersection=m?this.numPlanes:0,this.numPlanes+=M}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,f,g,_){let m=u!==null?u.length:0,p=null;if(m!==0){if(p=l.value,_!==!0||p===null){let d=g+m*4,M=f.matrixWorldInverse;a.getNormalMatrix(M),(p===null||p.length<d)&&(p=new Float32Array(d));for(let v=0,T=g;v!==m;++v,T+=4)o.copy(u[v]).applyMatrix4(M,a),o.normal.toArray(p,T),p[T+3]=o.constant}l.value=p,l.needsUpdate=!0}return e.numPlanes=m,e.numIntersection=0,p}}function Tp(i){let e=new WeakMap;function t(o,a){return a===ya?o.mapping=Ui:a===Ma&&(o.mapping=Ni),o}function n(o){if(o&&o.isTexture){let a=o.mapping;if(a===ya||a===Ma)if(e.has(o)){let l=e.get(o).texture;return t(l,o.mapping)}else{let l=o.image;if(l&&l.height>0){let c=new Ca(l.height/2);return c.fromEquirectangularTexture(i,o),e.set(o,c),o.addEventListener("dispose",s),t(c.texture,o.mapping)}else return null}}return o}function s(o){let a=o.target;a.removeEventListener("dispose",s);let l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}var dr=class extends hr{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,o=n+e,a=s+t,l=s-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=h*this.view.offsetY,l=a-h*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Ci=4,Dl=[.125,.215,.35,.446,.526,.582],ei=20,ua=new dr,Ul=new Te,da=null,fa=0,pa=0,jn=(1+Math.sqrt(5))/2,Ei=1/jn,Nl=[new D(1,1,1),new D(-1,1,1),new D(1,1,-1),new D(-1,1,-1),new D(0,jn,Ei),new D(0,jn,-Ei),new D(Ei,0,jn),new D(-Ei,0,jn),new D(jn,Ei,0),new D(-jn,Ei,0)],fr=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){da=this._renderer.getRenderTarget(),fa=this._renderer.getActiveCubeFace(),pa=this._renderer.getActiveMipmapLevel(),this._setSize(256);let r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Bl(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Ol(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(da,fa,pa),e.scissorTest=!1,Gs(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Ui||e.mapping===Ni?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),da=this._renderer.getRenderTarget(),fa=this._renderer.getActiveCubeFace(),pa=this._renderer.getActiveMipmapLevel();let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Nt,minFilter:Nt,generateMipmaps:!1,type:as,format:Xt,colorSpace:Tn,depthBuffer:!1},s=Fl(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Fl(e,t,n);let{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Ap(r)),this._blurMaterial=Rp(r,e,t)}return s}_compileMaterial(e){let t=new ot(this._lodPlanes[0],e);this._renderer.compile(t,ua)}_sceneToCubeUV(e,t,n,s){let a=new Ft(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,u=h.autoClear,f=h.toneMapping;h.getClearColor(Ul),h.toneMapping=zn,h.autoClear=!1;let g=new or({name:"PMREM.Background",side:Rt,depthWrite:!1,depthTest:!1}),_=new ot(new si,g),m=!1,p=e.background;p?p.isColor&&(g.color.copy(p),e.background=null,m=!0):(g.color.copy(Ul),m=!0);for(let d=0;d<6;d++){let M=d%3;M===0?(a.up.set(0,l[d],0),a.lookAt(c[d],0,0)):M===1?(a.up.set(0,0,l[d]),a.lookAt(0,c[d],0)):(a.up.set(0,l[d],0),a.lookAt(0,0,c[d]));let v=this._cubeSize;Gs(s,M*v,d>2?v:0,v,v),h.setRenderTarget(s),m&&h.render(_,a),h.render(e,a)}_.geometry.dispose(),_.material.dispose(),h.toneMapping=f,h.autoClear=u,e.background=p}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===Ui||e.mapping===Ni;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Bl()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Ol());let r=s?this._cubemapMaterial:this._equirectMaterial,o=new ot(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;let l=this._cubeSize;Gs(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(o,ua)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;for(let s=1;s<this._lodPlanes.length;s++){let r=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),o=Nl[(s-1)%Nl.length];this._blur(e,s-1,s,r,o)}t.autoClear=n}_blur(e,t,n,s,r){let o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let h=3,u=new ot(this._lodPlanes[s],c),f=c.uniforms,g=this._sizeLods[n]-1,_=isFinite(r)?Math.PI/(2*g):2*Math.PI/(2*ei-1),m=r/_,p=isFinite(r)?1+Math.floor(h*m):ei;p>ei&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${p} samples when the maximum is set to ${ei}`);let d=[],M=0;for(let A=0;A<ei;++A){let X=A/m,b=Math.exp(-X*X/2);d.push(b),A===0?M+=b:A<p&&(M+=2*b)}for(let A=0;A<d.length;A++)d[A]=d[A]/M;f.envMap.value=e.texture,f.samples.value=p,f.weights.value=d,f.latitudinal.value=o==="latitudinal",a&&(f.poleAxis.value=a);let{_lodMax:v}=this;f.dTheta.value=_,f.mipInt.value=v-n;let T=this._sizeLods[s],P=3*T*(s>v-Ci?s-v+Ci:0),R=4*(this._cubeSize-T);Gs(t,P,R,3*T,2*T),l.setRenderTarget(t),l.render(u,ua)}};function Ap(i){let e=[],t=[],n=[],s=i,r=i-Ci+1+Dl.length;for(let o=0;o<r;o++){let a=Math.pow(2,s);t.push(a);let l=1/a;o>i-Ci?l=Dl[o-i+Ci-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),h=-c,u=1+c,f=[h,h,u,h,u,u,h,h,u,u,h,u],g=6,_=6,m=3,p=2,d=1,M=new Float32Array(m*_*g),v=new Float32Array(p*_*g),T=new Float32Array(d*_*g);for(let R=0;R<g;R++){let A=R%3*2/3-1,X=R>2?0:-1,b=[A,X,0,A+2/3,X,0,A+2/3,X+1,0,A,X,0,A+2/3,X+1,0,A,X+1,0];M.set(b,m*_*R),v.set(f,p*_*R);let w=[R,R,R,R,R,R];T.set(w,d*_*R)}let P=new Ot;P.setAttribute("position",new xt(M,m)),P.setAttribute("uv",new xt(v,p)),P.setAttribute("faceIndex",new xt(T,d)),e.push(P),s>Ci&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Fl(i,e,t){let n=new An(i,e,t);return n.texture.mapping=Tr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Gs(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function Rp(i,e,t){let n=new Float32Array(ei),s=new D(0,1,0);return new on({name:"SphericalGaussianBlur",defines:{n:ei,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:lo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Bn,depthTest:!1,depthWrite:!1})}function Ol(){return new on({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:lo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Bn,depthTest:!1,depthWrite:!1})}function Bl(){return new on({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:lo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Bn,depthTest:!1,depthWrite:!1})}function lo(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Cp(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){let l=a.mapping,c=l===ya||l===Ma,h=l===Ui||l===Ni;if(c||h)if(a.isRenderTargetTexture&&a.needsPMREMUpdate===!0){a.needsPMREMUpdate=!1;let u=e.get(a);return t===null&&(t=new fr(i)),u=c?t.fromEquirectangular(a,u):t.fromCubemap(a,u),e.set(a,u),u.texture}else{if(e.has(a))return e.get(a).texture;{let u=a.image;if(c&&u&&u.height>0||h&&u&&s(u)){t===null&&(t=new fr(i));let f=c?t.fromEquirectangular(a):t.fromCubemap(a);return e.set(a,f),a.addEventListener("dispose",r),f.texture}else return null}}}return a}function s(a){let l=0,c=6;for(let h=0;h<c;h++)a[h]!==void 0&&l++;return l===c}function r(a){let l=a.target;l.removeEventListener("dispose",r);let c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function Pp(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(n){n.isWebGL2?(t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance")):(t("WEBGL_depth_texture"),t("OES_texture_float"),t("OES_texture_half_float"),t("OES_texture_half_float_linear"),t("OES_standard_derivatives"),t("OES_element_index_uint"),t("OES_vertex_array_object"),t("ANGLE_instanced_arrays")),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture")},get:function(n){let s=t(n);return s===null&&console.warn("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function Lp(i,e,t,n){let s={},r=new WeakMap;function o(u){let f=u.target;f.index!==null&&e.remove(f.index);for(let _ in f.attributes)e.remove(f.attributes[_]);for(let _ in f.morphAttributes){let m=f.morphAttributes[_];for(let p=0,d=m.length;p<d;p++)e.remove(m[p])}f.removeEventListener("dispose",o),delete s[f.id];let g=r.get(f);g&&(e.remove(g),r.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,t.memory.geometries--}function a(u,f){return s[f.id]===!0||(f.addEventListener("dispose",o),s[f.id]=!0,t.memory.geometries++),f}function l(u){let f=u.attributes;for(let _ in f)e.update(f[_],i.ARRAY_BUFFER);let g=u.morphAttributes;for(let _ in g){let m=g[_];for(let p=0,d=m.length;p<d;p++)e.update(m[p],i.ARRAY_BUFFER)}}function c(u){let f=[],g=u.index,_=u.attributes.position,m=0;if(g!==null){let M=g.array;m=g.version;for(let v=0,T=M.length;v<T;v+=3){let P=M[v+0],R=M[v+1],A=M[v+2];f.push(P,R,R,A,A,P)}}else if(_!==void 0){let M=_.array;m=_.version;for(let v=0,T=M.length/3-1;v<T;v+=3){let P=v+0,R=v+1,A=v+2;f.push(P,R,R,A,A,P)}}else return;let p=new(Sc(f)?cr:lr)(f,1);p.version=m;let d=r.get(u);d&&e.remove(d),r.set(u,p)}function h(u){let f=r.get(u);if(f){let g=u.index;g!==null&&f.version<g.version&&c(u)}else c(u);return r.get(u)}return{get:a,update:l,getWireframeAttribute:h}}function Ip(i,e,t,n){let s=n.isWebGL2,r;function o(g){r=g}let a,l;function c(g){a=g.type,l=g.bytesPerElement}function h(g,_){i.drawElements(r,_,a,g*l),t.update(_,r,1)}function u(g,_,m){if(m===0)return;let p,d;if(s)p=i,d="drawElementsInstanced";else if(p=e.get("ANGLE_instanced_arrays"),d="drawElementsInstancedANGLE",p===null){console.error("THREE.WebGLIndexedBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}p[d](r,_,a,g*l,m),t.update(_,r,m)}function f(g,_,m){if(m===0)return;let p=e.get("WEBGL_multi_draw");if(p===null)for(let d=0;d<m;d++)this.render(g[d]/l,_[d]);else{p.multiDrawElementsWEBGL(r,_,0,a,g,0,m);let d=0;for(let M=0;M<m;M++)d+=_[M];t.update(d,r,1)}}this.setMode=o,this.setIndex=c,this.render=h,this.renderInstances=u,this.renderMultiDraw=f}function Dp(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Up(i,e){return i[0]-e[0]}function Np(i,e){return Math.abs(e[1])-Math.abs(i[1])}function Fp(i,e,t){let n={},s=new Float32Array(8),r=new WeakMap,o=new _t,a=[];for(let c=0;c<8;c++)a[c]=[c,0];function l(c,h,u){let f=c.morphTargetInfluences;if(e.isWebGL2===!0){let g=h.morphAttributes.position||h.morphAttributes.normal||h.morphAttributes.color,_=g!==void 0?g.length:0,m=r.get(h);if(m===void 0||m.count!==_){let I=function(){ee.dispose(),r.delete(h),h.removeEventListener("dispose",I)};m!==void 0&&m.texture.dispose();let M=h.morphAttributes.position!==void 0,v=h.morphAttributes.normal!==void 0,T=h.morphAttributes.color!==void 0,P=h.morphAttributes.position||[],R=h.morphAttributes.normal||[],A=h.morphAttributes.color||[],X=0;M===!0&&(X=1),v===!0&&(X=2),T===!0&&(X=3);let b=h.attributes.position.count*X,w=1;b>e.maxTextureSize&&(w=Math.ceil(b/e.maxTextureSize),b=e.maxTextureSize);let N=new Float32Array(b*w*4*_),ee=new sr(N,b,w,_);ee.type=On,ee.needsUpdate=!0;let ue=X*4;for(let U=0;U<_;U++){let q=P[U],Q=R[U],j=A[U],J=b*w*4*U;for(let te=0;te<q.count;te++){let re=te*ue;M===!0&&(o.fromBufferAttribute(q,te),N[J+re+0]=o.x,N[J+re+1]=o.y,N[J+re+2]=o.z,N[J+re+3]=0),v===!0&&(o.fromBufferAttribute(Q,te),N[J+re+4]=o.x,N[J+re+5]=o.y,N[J+re+6]=o.z,N[J+re+7]=0),T===!0&&(o.fromBufferAttribute(j,te),N[J+re+8]=o.x,N[J+re+9]=o.y,N[J+re+10]=o.z,N[J+re+11]=j.itemSize===4?o.w:1)}}m={count:_,texture:ee,size:new De(b,w)},r.set(h,m),h.addEventListener("dispose",I)}let p=0;for(let M=0;M<f.length;M++)p+=f[M];let d=h.morphTargetsRelative?1:1-p;u.getUniforms().setValue(i,"morphTargetBaseInfluence",d),u.getUniforms().setValue(i,"morphTargetInfluences",f),u.getUniforms().setValue(i,"morphTargetsTexture",m.texture,t),u.getUniforms().setValue(i,"morphTargetsTextureSize",m.size)}else{let g=f===void 0?0:f.length,_=n[h.id];if(_===void 0||_.length!==g){_=[];for(let v=0;v<g;v++)_[v]=[v,0];n[h.id]=_}for(let v=0;v<g;v++){let T=_[v];T[0]=v,T[1]=f[v]}_.sort(Np);for(let v=0;v<8;v++)v<g&&_[v][1]?(a[v][0]=_[v][0],a[v][1]=_[v][1]):(a[v][0]=Number.MAX_SAFE_INTEGER,a[v][1]=0);a.sort(Up);let m=h.morphAttributes.position,p=h.morphAttributes.normal,d=0;for(let v=0;v<8;v++){let T=a[v],P=T[0],R=T[1];P!==Number.MAX_SAFE_INTEGER&&R?(m&&h.getAttribute("morphTarget"+v)!==m[P]&&h.setAttribute("morphTarget"+v,m[P]),p&&h.getAttribute("morphNormal"+v)!==p[P]&&h.setAttribute("morphNormal"+v,p[P]),s[v]=R,d+=R):(m&&h.hasAttribute("morphTarget"+v)===!0&&h.deleteAttribute("morphTarget"+v),p&&h.hasAttribute("morphNormal"+v)===!0&&h.deleteAttribute("morphNormal"+v),s[v]=0)}let M=h.morphTargetsRelative?1:1-d;u.getUniforms().setValue(i,"morphTargetBaseInfluence",M),u.getUniforms().setValue(i,"morphTargetInfluences",s)}}return{update:l}}function Op(i,e,t,n){let s=new WeakMap;function r(l){let c=n.render.frame,h=l.geometry,u=e.get(l,h);if(s.get(u)!==c&&(e.update(u),s.set(u,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){let f=l.skeleton;s.get(f)!==c&&(f.update(),s.set(f,c))}return u}function o(){s=new WeakMap}function a(l){let c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:o}}var pr=class extends Qt{constructor(e,t,n,s,r,o,a,l,c,h){if(h=h!==void 0?h:ni,h!==ni&&h!==Fi)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===ni&&(n=Fn),n===void 0&&h===Fi&&(n=ti),super(null,s,r,o,a,l,h,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:yt,this.minFilter=l!==void 0?l:yt,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},Ac=new Qt,Rc=new pr(1,1);Rc.compareFunction=bc;var Cc=new sr,Pc=new Aa,Lc=new ur,zl=[],kl=[],Hl=new Float32Array(16),Vl=new Float32Array(9),Gl=new Float32Array(4);function Vi(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=zl[s];if(r===void 0&&(r=new Float32Array(s),zl[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function ut(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function dt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Rr(i,e){let t=kl[e];t===void 0&&(t=new Int32Array(e),kl[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Bp(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function zp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ut(t,e))return;i.uniform2fv(this.addr,e),dt(t,e)}}function kp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(ut(t,e))return;i.uniform3fv(this.addr,e),dt(t,e)}}function Hp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ut(t,e))return;i.uniform4fv(this.addr,e),dt(t,e)}}function Vp(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(ut(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),dt(t,e)}else{if(ut(t,n))return;Gl.set(n),i.uniformMatrix2fv(this.addr,!1,Gl),dt(t,n)}}function Gp(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(ut(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),dt(t,e)}else{if(ut(t,n))return;Vl.set(n),i.uniformMatrix3fv(this.addr,!1,Vl),dt(t,n)}}function Wp(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(ut(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),dt(t,e)}else{if(ut(t,n))return;Hl.set(n),i.uniformMatrix4fv(this.addr,!1,Hl),dt(t,n)}}function Xp(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function qp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ut(t,e))return;i.uniform2iv(this.addr,e),dt(t,e)}}function Yp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ut(t,e))return;i.uniform3iv(this.addr,e),dt(t,e)}}function Zp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ut(t,e))return;i.uniform4iv(this.addr,e),dt(t,e)}}function Jp(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function $p(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ut(t,e))return;i.uniform2uiv(this.addr,e),dt(t,e)}}function Kp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ut(t,e))return;i.uniform3uiv(this.addr,e),dt(t,e)}}function jp(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ut(t,e))return;i.uniform4uiv(this.addr,e),dt(t,e)}}function Qp(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r=this.type===i.SAMPLER_2D_SHADOW?Rc:Ac;t.setTexture2D(e||r,s)}function em(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||Pc,s)}function tm(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||Lc,s)}function nm(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||Cc,s)}function im(i){switch(i){case 5126:return Bp;case 35664:return zp;case 35665:return kp;case 35666:return Hp;case 35674:return Vp;case 35675:return Gp;case 35676:return Wp;case 5124:case 35670:return Xp;case 35667:case 35671:return qp;case 35668:case 35672:return Yp;case 35669:case 35673:return Zp;case 5125:return Jp;case 36294:return $p;case 36295:return Kp;case 36296:return jp;case 35678:case 36198:case 36298:case 36306:case 35682:return Qp;case 35679:case 36299:case 36307:return em;case 35680:case 36300:case 36308:case 36293:return tm;case 36289:case 36303:case 36311:case 36292:return nm}}function sm(i,e){i.uniform1fv(this.addr,e)}function rm(i,e){let t=Vi(e,this.size,2);i.uniform2fv(this.addr,t)}function am(i,e){let t=Vi(e,this.size,3);i.uniform3fv(this.addr,t)}function om(i,e){let t=Vi(e,this.size,4);i.uniform4fv(this.addr,t)}function lm(i,e){let t=Vi(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function cm(i,e){let t=Vi(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function hm(i,e){let t=Vi(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function um(i,e){i.uniform1iv(this.addr,e)}function dm(i,e){i.uniform2iv(this.addr,e)}function fm(i,e){i.uniform3iv(this.addr,e)}function pm(i,e){i.uniform4iv(this.addr,e)}function mm(i,e){i.uniform1uiv(this.addr,e)}function gm(i,e){i.uniform2uiv(this.addr,e)}function _m(i,e){i.uniform3uiv(this.addr,e)}function xm(i,e){i.uniform4uiv(this.addr,e)}function vm(i,e,t){let n=this.cache,s=e.length,r=Rr(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),dt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||Ac,r[o])}function ym(i,e,t){let n=this.cache,s=e.length,r=Rr(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),dt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||Pc,r[o])}function Mm(i,e,t){let n=this.cache,s=e.length,r=Rr(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),dt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||Lc,r[o])}function bm(i,e,t){let n=this.cache,s=e.length,r=Rr(t,s);ut(n,r)||(i.uniform1iv(this.addr,r),dt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||Cc,r[o])}function Sm(i){switch(i){case 5126:return sm;case 35664:return rm;case 35665:return am;case 35666:return om;case 35674:return lm;case 35675:return cm;case 35676:return hm;case 5124:case 35670:return um;case 35667:case 35671:return dm;case 35668:case 35672:return fm;case 35669:case 35673:return pm;case 5125:return mm;case 36294:return gm;case 36295:return _m;case 36296:return xm;case 35678:case 36198:case 36298:case 36306:case 35682:return vm;case 35679:case 36299:case 36307:return ym;case 35680:case 36300:case 36308:case 36293:return Mm;case 36289:case 36303:case 36311:case 36292:return bm}}var Pa=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=im(t.type)}},La=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Sm(t.type)}},Ia=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,o=s.length;r!==o;++r){let a=s[r];a.setValue(e,t[a.id],n)}}},ma=/(\w+)(\])?(\[|\.)?/g;function Wl(i,e){i.seq.push(e),i.map[e.id]=e}function wm(i,e,t){let n=i.name,s=n.length;for(ma.lastIndex=0;;){let r=ma.exec(n),o=ma.lastIndex,a=r[1],l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){Wl(t,c===void 0?new Pa(a,i,e):new La(a,i,e));break}else{let u=t.map[a];u===void 0&&(u=new Ia(a),Wl(t,u)),t=u}}}var Di=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){let r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);wm(r,o,this)}}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){let a=t[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let o=e[s];o.id in t&&n.push(o)}return n}};function Xl(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var Em=37297,Tm=0;function Am(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){let a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}function Rm(i){let e=$e.getPrimaries($e.workingColorSpace),t=$e.getPrimaries(i),n;switch(e===t?n="":e===js&&t===Ks?n="LinearDisplayP3ToLinearSRGB":e===Ks&&t===js&&(n="LinearSRGBToLinearDisplayP3"),i){case Tn:case Ar:return[n,"LinearTransferOETF"];case Mt:case ro:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function ql(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";let r=/ERROR: 0:(\d+)/.exec(s);if(r){let o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+Am(i.getShaderSource(e),o)}else return s}function Cm(i,e){let t=Rm(e);return`vec4 ${i}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function Pm(i,e){let t;switch(e){case Fh:t="Linear";break;case Oh:t="Reinhard";break;case Bh:t="OptimizedCineon";break;case io:t="ACESFilmic";break;case kh:t="AgX";break;case zh:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}function Lm(i){return[i.extensionDerivatives||i.envMapCubeUVHeight||i.bumpMap||i.normalMapTangentSpace||i.clearcoatNormalMap||i.flatShading||i.shaderID==="physical"?"#extension GL_OES_standard_derivatives : enable":"",(i.extensionFragDepth||i.logarithmicDepthBuffer)&&i.rendererExtensionFragDepth?"#extension GL_EXT_frag_depth : enable":"",i.extensionDrawBuffers&&i.rendererExtensionDrawBuffers?"#extension GL_EXT_draw_buffers : require":"",(i.extensionShaderTextureLOD||i.envMap||i.transmission)&&i.rendererExtensionShaderTextureLod?"#extension GL_EXT_shader_texture_lod : enable":""].filter(Pi).join(`
`)}function Im(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":""].filter(Pi).join(`
`)}function Dm(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Um(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),o=r.name,a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function Pi(i){return i!==""}function Yl(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Zl(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Nm=/^[ \t]*#include +<([\w\d./]+)>/gm;function Da(i){return i.replace(Nm,Om)}var Fm=new Map([["encodings_fragment","colorspace_fragment"],["encodings_pars_fragment","colorspace_pars_fragment"],["output_fragment","opaque_fragment"]]);function Om(i,e){let t=Ve[e];if(t===void 0){let n=Fm.get(e);if(n!==void 0)t=Ve[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Da(t)}var Bm=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Jl(i){return i.replace(Bm,zm)}function zm(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function $l(i){let e="precision "+i.precision+` float;
precision `+i.precision+" int;";return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function km(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===hc?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===no?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===Sn&&(e="SHADOWMAP_TYPE_VSM"),e}function Hm(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case Ui:case Ni:e="ENVMAP_TYPE_CUBE";break;case Tr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function Vm(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ni:e="ENVMAP_MODE_REFRACTION";break}return e}function Gm(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case uc:e="ENVMAP_BLENDING_MULTIPLY";break;case Uh:e="ENVMAP_BLENDING_MIX";break;case Nh:e="ENVMAP_BLENDING_ADD";break}return e}function Wm(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function Xm(i,e,t,n){let s=i.getContext(),r=t.defines,o=t.vertexShader,a=t.fragmentShader,l=km(t),c=Hm(t),h=Vm(t),u=Gm(t),f=Wm(t),g=t.isWebGL2?"":Lm(t),_=Im(t),m=Dm(r),p=s.createProgram(),d,M,v=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(d=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(Pi).join(`
`),d.length>0&&(d+=`
`),M=[g,"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(Pi).join(`
`),M.length>0&&(M+=`
`)):(d=[$l(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors&&t.isWebGL2?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#if ( defined( USE_MORPHTARGETS ) && ! defined( MORPHTARGETS_TEXTURE ) )","	attribute vec3 morphTarget0;","	attribute vec3 morphTarget1;","	attribute vec3 morphTarget2;","	attribute vec3 morphTarget3;","	#ifdef USE_MORPHNORMALS","		attribute vec3 morphNormal0;","		attribute vec3 morphNormal1;","		attribute vec3 morphNormal2;","		attribute vec3 morphNormal3;","	#else","		attribute vec3 morphTarget4;","		attribute vec3 morphTarget5;","		attribute vec3 morphTarget6;","		attribute vec3 morphTarget7;","	#endif","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Pi).join(`
`),M=[g,$l(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==zn?"#define TONE_MAPPING":"",t.toneMapping!==zn?Ve.tonemapping_pars_fragment:"",t.toneMapping!==zn?Pm("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ve.colorspace_pars_fragment,Cm("linearToOutputTexel",t.outputColorSpace),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Pi).join(`
`)),o=Da(o),o=Yl(o,t),o=Zl(o,t),a=Da(a),a=Yl(a,t),a=Zl(a,t),o=Jl(o),a=Jl(a),t.isWebGL2&&t.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,d=[_,"precision mediump sampler2DArray;","#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+d,M=["precision mediump sampler2DArray;","#define varying in",t.glslVersion===ml?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===ml?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+M);let T=v+d+o,P=v+M+a,R=Xl(s,s.VERTEX_SHADER,T),A=Xl(s,s.FRAGMENT_SHADER,P);s.attachShader(p,R),s.attachShader(p,A),t.index0AttributeName!==void 0?s.bindAttribLocation(p,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(p,0,"position"),s.linkProgram(p);function X(ee){if(i.debug.checkShaderErrors){let ue=s.getProgramInfoLog(p).trim(),I=s.getShaderInfoLog(R).trim(),U=s.getShaderInfoLog(A).trim(),q=!0,Q=!0;if(s.getProgramParameter(p,s.LINK_STATUS)===!1)if(q=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,p,R,A);else{let j=ql(s,R,"vertex"),J=ql(s,A,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(p,s.VALIDATE_STATUS)+`

Program Info Log: `+ue+`
`+j+`
`+J)}else ue!==""?console.warn("THREE.WebGLProgram: Program Info Log:",ue):(I===""||U==="")&&(Q=!1);Q&&(ee.diagnostics={runnable:q,programLog:ue,vertexShader:{log:I,prefix:d},fragmentShader:{log:U,prefix:M}})}s.deleteShader(R),s.deleteShader(A),b=new Di(s,p),w=Um(s,p)}let b;this.getUniforms=function(){return b===void 0&&X(this),b};let w;this.getAttributes=function(){return w===void 0&&X(this),w};let N=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return N===!1&&(N=s.getProgramParameter(p,Em)),N},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(p),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Tm++,this.cacheKey=e,this.usedTimes=1,this.program=p,this.vertexShader=R,this.fragmentShader=A,this}var qm=0,Ua=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Na(e),t.set(e,n)),n}},Na=class{constructor(e){this.id=qm++,this.code=e,this.usedTimes=0}};function Ym(i,e,t,n,s,r,o){let a=new ar,l=new Ua,c=[],h=s.isWebGL2,u=s.logarithmicDepthBuffer,f=s.vertexTextures,g=s.precision,_={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function m(b){return b===0?"uv":`uv${b}`}function p(b,w,N,ee,ue){let I=ee.fog,U=ue.geometry,q=b.isMeshStandardMaterial?ee.environment:null,Q=(b.isMeshStandardMaterial?t:e).get(b.envMap||q),j=Q&&Q.mapping===Tr?Q.image.height:null,J=_[b.type];b.precision!==null&&(g=s.getMaxPrecision(b.precision),g!==b.precision&&console.warn("THREE.WebGLProgram.getParameters:",b.precision,"not supported, using",g,"instead."));let te=U.morphAttributes.position||U.morphAttributes.normal||U.morphAttributes.color,re=te!==void 0?te.length:0,fe=0;U.morphAttributes.position!==void 0&&(fe=1),U.morphAttributes.normal!==void 0&&(fe=2),U.morphAttributes.color!==void 0&&(fe=3);let H,ne,de,ge;if(J){let Lt=dn[J];H=Lt.vertexShader,ne=Lt.fragmentShader}else H=b.vertexShader,ne=b.fragmentShader,l.update(b),de=l.getVertexShaderID(b),ge=l.getFragmentShaderID(b);let ye=i.getRenderTarget(),Le=ue.isInstancedMesh===!0,Ie=ue.isBatchedMesh===!0,Ee=!!b.map,ke=!!b.matcap,O=!!Q,Ke=!!b.aoMap,be=!!b.lightMap,Pe=!!b.bumpMap,Me=!!b.normalMap,W=!!b.displacementMap,G=!!b.emissiveMap,y=!!b.metalnessMap,x=!!b.roughnessMap,L=b.anisotropy>0,Y=b.clearcoat>0,Z=b.iridescence>0,B=b.sheen>0,pe=b.transmission>0,ce=L&&!!b.anisotropyMap,he=Y&&!!b.clearcoatMap,_e=Y&&!!b.clearcoatNormalMap,Re=Y&&!!b.clearcoatRoughnessMap,$=Z&&!!b.iridescenceMap,xe=Z&&!!b.iridescenceThicknessMap,E=B&&!!b.sheenColorMap,K=B&&!!b.sheenRoughnessMap,ie=!!b.specularMap,se=!!b.specularColorMap,Se=!!b.specularIntensityMap,He=pe&&!!b.transmissionMap,qe=pe&&!!b.thicknessMap,Oe=!!b.gradientMap,oe=!!b.alphaMap,C=b.alphaTest>0,ae=!!b.alphaHash,le=!!b.extensions,Ce=!!U.attributes.uv1,we=!!U.attributes.uv2,Ye=!!U.attributes.uv3,Ze=zn;return b.toneMapped&&(ye===null||ye.isXRRenderTarget===!0)&&(Ze=i.toneMapping),{isWebGL2:h,shaderID:J,shaderType:b.type,shaderName:b.name,vertexShader:H,fragmentShader:ne,defines:b.defines,customVertexShaderID:de,customFragmentShaderID:ge,isRawShaderMaterial:b.isRawShaderMaterial===!0,glslVersion:b.glslVersion,precision:g,batching:Ie,instancing:Le,instancingColor:Le&&ue.instanceColor!==null,supportsVertexTextures:f,outputColorSpace:ye===null?i.outputColorSpace:ye.isXRRenderTarget===!0?ye.texture.colorSpace:Tn,map:Ee,matcap:ke,envMap:O,envMapMode:O&&Q.mapping,envMapCubeUVHeight:j,aoMap:Ke,lightMap:be,bumpMap:Pe,normalMap:Me,displacementMap:f&&W,emissiveMap:G,normalMapObjectSpace:Me&&b.normalMapType===jh,normalMapTangentSpace:Me&&b.normalMapType===Mc,metalnessMap:y,roughnessMap:x,anisotropy:L,anisotropyMap:ce,clearcoat:Y,clearcoatMap:he,clearcoatNormalMap:_e,clearcoatRoughnessMap:Re,iridescence:Z,iridescenceMap:$,iridescenceThicknessMap:xe,sheen:B,sheenColorMap:E,sheenRoughnessMap:K,specularMap:ie,specularColorMap:se,specularIntensityMap:Se,transmission:pe,transmissionMap:He,thicknessMap:qe,gradientMap:Oe,opaque:b.transparent===!1&&b.blending===Li,alphaMap:oe,alphaTest:C,alphaHash:ae,combine:b.combine,mapUv:Ee&&m(b.map.channel),aoMapUv:Ke&&m(b.aoMap.channel),lightMapUv:be&&m(b.lightMap.channel),bumpMapUv:Pe&&m(b.bumpMap.channel),normalMapUv:Me&&m(b.normalMap.channel),displacementMapUv:W&&m(b.displacementMap.channel),emissiveMapUv:G&&m(b.emissiveMap.channel),metalnessMapUv:y&&m(b.metalnessMap.channel),roughnessMapUv:x&&m(b.roughnessMap.channel),anisotropyMapUv:ce&&m(b.anisotropyMap.channel),clearcoatMapUv:he&&m(b.clearcoatMap.channel),clearcoatNormalMapUv:_e&&m(b.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Re&&m(b.clearcoatRoughnessMap.channel),iridescenceMapUv:$&&m(b.iridescenceMap.channel),iridescenceThicknessMapUv:xe&&m(b.iridescenceThicknessMap.channel),sheenColorMapUv:E&&m(b.sheenColorMap.channel),sheenRoughnessMapUv:K&&m(b.sheenRoughnessMap.channel),specularMapUv:ie&&m(b.specularMap.channel),specularColorMapUv:se&&m(b.specularColorMap.channel),specularIntensityMapUv:Se&&m(b.specularIntensityMap.channel),transmissionMapUv:He&&m(b.transmissionMap.channel),thicknessMapUv:qe&&m(b.thicknessMap.channel),alphaMapUv:oe&&m(b.alphaMap.channel),vertexTangents:!!U.attributes.tangent&&(Me||L),vertexColors:b.vertexColors,vertexAlphas:b.vertexColors===!0&&!!U.attributes.color&&U.attributes.color.itemSize===4,vertexUv1s:Ce,vertexUv2s:we,vertexUv3s:Ye,pointsUvs:ue.isPoints===!0&&!!U.attributes.uv&&(Ee||oe),fog:!!I,useFog:b.fog===!0,fogExp2:I&&I.isFogExp2,flatShading:b.flatShading===!0,sizeAttenuation:b.sizeAttenuation===!0,logarithmicDepthBuffer:u,skinning:ue.isSkinnedMesh===!0,morphTargets:U.morphAttributes.position!==void 0,morphNormals:U.morphAttributes.normal!==void 0,morphColors:U.morphAttributes.color!==void 0,morphTargetsCount:re,morphTextureStride:fe,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:b.dithering,shadowMapEnabled:i.shadowMap.enabled&&N.length>0,shadowMapType:i.shadowMap.type,toneMapping:Ze,useLegacyLights:i._useLegacyLights,decodeVideoTexture:Ee&&b.map.isVideoTexture===!0&&$e.getTransfer(b.map.colorSpace)===et,premultipliedAlpha:b.premultipliedAlpha,doubleSided:b.side===wn,flipSided:b.side===Rt,useDepthPacking:b.depthPacking>=0,depthPacking:b.depthPacking||0,index0AttributeName:b.index0AttributeName,extensionDerivatives:le&&b.extensions.derivatives===!0,extensionFragDepth:le&&b.extensions.fragDepth===!0,extensionDrawBuffers:le&&b.extensions.drawBuffers===!0,extensionShaderTextureLOD:le&&b.extensions.shaderTextureLOD===!0,extensionClipCullDistance:le&&b.extensions.clipCullDistance&&n.has("WEBGL_clip_cull_distance"),rendererExtensionFragDepth:h||n.has("EXT_frag_depth"),rendererExtensionDrawBuffers:h||n.has("WEBGL_draw_buffers"),rendererExtensionShaderTextureLod:h||n.has("EXT_shader_texture_lod"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:b.customProgramCacheKey()}}function d(b){let w=[];if(b.shaderID?w.push(b.shaderID):(w.push(b.customVertexShaderID),w.push(b.customFragmentShaderID)),b.defines!==void 0)for(let N in b.defines)w.push(N),w.push(b.defines[N]);return b.isRawShaderMaterial===!1&&(M(w,b),v(w,b),w.push(i.outputColorSpace)),w.push(b.customProgramCacheKey),w.join()}function M(b,w){b.push(w.precision),b.push(w.outputColorSpace),b.push(w.envMapMode),b.push(w.envMapCubeUVHeight),b.push(w.mapUv),b.push(w.alphaMapUv),b.push(w.lightMapUv),b.push(w.aoMapUv),b.push(w.bumpMapUv),b.push(w.normalMapUv),b.push(w.displacementMapUv),b.push(w.emissiveMapUv),b.push(w.metalnessMapUv),b.push(w.roughnessMapUv),b.push(w.anisotropyMapUv),b.push(w.clearcoatMapUv),b.push(w.clearcoatNormalMapUv),b.push(w.clearcoatRoughnessMapUv),b.push(w.iridescenceMapUv),b.push(w.iridescenceThicknessMapUv),b.push(w.sheenColorMapUv),b.push(w.sheenRoughnessMapUv),b.push(w.specularMapUv),b.push(w.specularColorMapUv),b.push(w.specularIntensityMapUv),b.push(w.transmissionMapUv),b.push(w.thicknessMapUv),b.push(w.combine),b.push(w.fogExp2),b.push(w.sizeAttenuation),b.push(w.morphTargetsCount),b.push(w.morphAttributeCount),b.push(w.numDirLights),b.push(w.numPointLights),b.push(w.numSpotLights),b.push(w.numSpotLightMaps),b.push(w.numHemiLights),b.push(w.numRectAreaLights),b.push(w.numDirLightShadows),b.push(w.numPointLightShadows),b.push(w.numSpotLightShadows),b.push(w.numSpotLightShadowsWithMaps),b.push(w.numLightProbes),b.push(w.shadowMapType),b.push(w.toneMapping),b.push(w.numClippingPlanes),b.push(w.numClipIntersection),b.push(w.depthPacking)}function v(b,w){a.disableAll(),w.isWebGL2&&a.enable(0),w.supportsVertexTextures&&a.enable(1),w.instancing&&a.enable(2),w.instancingColor&&a.enable(3),w.matcap&&a.enable(4),w.envMap&&a.enable(5),w.normalMapObjectSpace&&a.enable(6),w.normalMapTangentSpace&&a.enable(7),w.clearcoat&&a.enable(8),w.iridescence&&a.enable(9),w.alphaTest&&a.enable(10),w.vertexColors&&a.enable(11),w.vertexAlphas&&a.enable(12),w.vertexUv1s&&a.enable(13),w.vertexUv2s&&a.enable(14),w.vertexUv3s&&a.enable(15),w.vertexTangents&&a.enable(16),w.anisotropy&&a.enable(17),w.alphaHash&&a.enable(18),w.batching&&a.enable(19),b.push(a.mask),a.disableAll(),w.fog&&a.enable(0),w.useFog&&a.enable(1),w.flatShading&&a.enable(2),w.logarithmicDepthBuffer&&a.enable(3),w.skinning&&a.enable(4),w.morphTargets&&a.enable(5),w.morphNormals&&a.enable(6),w.morphColors&&a.enable(7),w.premultipliedAlpha&&a.enable(8),w.shadowMapEnabled&&a.enable(9),w.useLegacyLights&&a.enable(10),w.doubleSided&&a.enable(11),w.flipSided&&a.enable(12),w.useDepthPacking&&a.enable(13),w.dithering&&a.enable(14),w.transmission&&a.enable(15),w.sheen&&a.enable(16),w.opaque&&a.enable(17),w.pointsUvs&&a.enable(18),w.decodeVideoTexture&&a.enable(19),b.push(a.mask)}function T(b){let w=_[b.type],N;if(w){let ee=dn[w];N=oo.clone(ee.uniforms)}else N=b.uniforms;return N}function P(b,w){let N;for(let ee=0,ue=c.length;ee<ue;ee++){let I=c[ee];if(I.cacheKey===w){N=I,++N.usedTimes;break}}return N===void 0&&(N=new Xm(i,w,b,r),c.push(N)),N}function R(b){if(--b.usedTimes===0){let w=c.indexOf(b);c[w]=c[c.length-1],c.pop(),b.destroy()}}function A(b){l.remove(b)}function X(){l.dispose()}return{getParameters:p,getProgramCacheKey:d,getUniforms:T,acquireProgram:P,releaseProgram:R,releaseShaderCache:A,programs:c,dispose:X}}function Zm(){let i=new WeakMap;function e(r){let o=i.get(r);return o===void 0&&(o={},i.set(r,o)),o}function t(r){i.delete(r)}function n(r,o,a){i.get(r)[o]=a}function s(){i=new WeakMap}return{get:e,remove:t,update:n,dispose:s}}function Jm(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function Kl(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function jl(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(u,f,g,_,m,p){let d=i[e];return d===void 0?(d={id:u.id,object:u,geometry:f,material:g,groupOrder:_,renderOrder:u.renderOrder,z:m,group:p},i[e]=d):(d.id=u.id,d.object=u,d.geometry=f,d.material=g,d.groupOrder=_,d.renderOrder=u.renderOrder,d.z=m,d.group=p),e++,d}function a(u,f,g,_,m,p){let d=o(u,f,g,_,m,p);g.transmission>0?n.push(d):g.transparent===!0?s.push(d):t.push(d)}function l(u,f,g,_,m,p){let d=o(u,f,g,_,m,p);g.transmission>0?n.unshift(d):g.transparent===!0?s.unshift(d):t.unshift(d)}function c(u,f){t.length>1&&t.sort(u||Jm),n.length>1&&n.sort(f||Kl),s.length>1&&s.sort(f||Kl)}function h(){for(let u=e,f=i.length;u<f;u++){let g=i[u];if(g.id===null)break;g.id=null,g.object=null,g.geometry=null,g.material=null,g.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:h,sort:c}}function $m(){let i=new WeakMap;function e(n,s){let r=i.get(n),o;return r===void 0?(o=new jl,i.set(n,[o])):s>=r.length?(o=new jl,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function Km(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new D,color:new Te};break;case"SpotLight":t={position:new D,direction:new D,color:new Te,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new D,color:new Te,distance:0,decay:0};break;case"HemisphereLight":t={direction:new D,skyColor:new Te,groundColor:new Te};break;case"RectAreaLight":t={color:new Te,position:new D,halfWidth:new D,halfHeight:new D};break}return i[e.id]=t,t}}}function jm(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new De};break;case"SpotLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new De};break;case"PointLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new De,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var Qm=0;function eg(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function tg(i,e){let t=new Km,n=jm(),s={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)s.probe.push(new D);let r=new D,o=new rt,a=new rt;function l(h,u){let f=0,g=0,_=0;for(let ee=0;ee<9;ee++)s.probe[ee].set(0,0,0);let m=0,p=0,d=0,M=0,v=0,T=0,P=0,R=0,A=0,X=0,b=0;h.sort(eg);let w=u===!0?Math.PI:1;for(let ee=0,ue=h.length;ee<ue;ee++){let I=h[ee],U=I.color,q=I.intensity,Q=I.distance,j=I.shadow&&I.shadow.map?I.shadow.map.texture:null;if(I.isAmbientLight)f+=U.r*q*w,g+=U.g*q*w,_+=U.b*q*w;else if(I.isLightProbe){for(let J=0;J<9;J++)s.probe[J].addScaledVector(I.sh.coefficients[J],q);b++}else if(I.isDirectionalLight){let J=t.get(I);if(J.color.copy(I.color).multiplyScalar(I.intensity*w),I.castShadow){let te=I.shadow,re=n.get(I);re.shadowBias=te.bias,re.shadowNormalBias=te.normalBias,re.shadowRadius=te.radius,re.shadowMapSize=te.mapSize,s.directionalShadow[m]=re,s.directionalShadowMap[m]=j,s.directionalShadowMatrix[m]=I.shadow.matrix,T++}s.directional[m]=J,m++}else if(I.isSpotLight){let J=t.get(I);J.position.setFromMatrixPosition(I.matrixWorld),J.color.copy(U).multiplyScalar(q*w),J.distance=Q,J.coneCos=Math.cos(I.angle),J.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),J.decay=I.decay,s.spot[d]=J;let te=I.shadow;if(I.map&&(s.spotLightMap[A]=I.map,A++,te.updateMatrices(I),I.castShadow&&X++),s.spotLightMatrix[d]=te.matrix,I.castShadow){let re=n.get(I);re.shadowBias=te.bias,re.shadowNormalBias=te.normalBias,re.shadowRadius=te.radius,re.shadowMapSize=te.mapSize,s.spotShadow[d]=re,s.spotShadowMap[d]=j,R++}d++}else if(I.isRectAreaLight){let J=t.get(I);J.color.copy(U).multiplyScalar(q),J.halfWidth.set(I.width*.5,0,0),J.halfHeight.set(0,I.height*.5,0),s.rectArea[M]=J,M++}else if(I.isPointLight){let J=t.get(I);if(J.color.copy(I.color).multiplyScalar(I.intensity*w),J.distance=I.distance,J.decay=I.decay,I.castShadow){let te=I.shadow,re=n.get(I);re.shadowBias=te.bias,re.shadowNormalBias=te.normalBias,re.shadowRadius=te.radius,re.shadowMapSize=te.mapSize,re.shadowCameraNear=te.camera.near,re.shadowCameraFar=te.camera.far,s.pointShadow[p]=re,s.pointShadowMap[p]=j,s.pointShadowMatrix[p]=I.shadow.matrix,P++}s.point[p]=J,p++}else if(I.isHemisphereLight){let J=t.get(I);J.skyColor.copy(I.color).multiplyScalar(q*w),J.groundColor.copy(I.groundColor).multiplyScalar(q*w),s.hemi[v]=J,v++}}M>0&&(e.isWebGL2?i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=me.LTC_FLOAT_1,s.rectAreaLTC2=me.LTC_FLOAT_2):(s.rectAreaLTC1=me.LTC_HALF_1,s.rectAreaLTC2=me.LTC_HALF_2):i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=me.LTC_FLOAT_1,s.rectAreaLTC2=me.LTC_FLOAT_2):i.has("OES_texture_half_float_linear")===!0?(s.rectAreaLTC1=me.LTC_HALF_1,s.rectAreaLTC2=me.LTC_HALF_2):console.error("THREE.WebGLRenderer: Unable to use RectAreaLight. Missing WebGL extensions.")),s.ambient[0]=f,s.ambient[1]=g,s.ambient[2]=_;let N=s.hash;(N.directionalLength!==m||N.pointLength!==p||N.spotLength!==d||N.rectAreaLength!==M||N.hemiLength!==v||N.numDirectionalShadows!==T||N.numPointShadows!==P||N.numSpotShadows!==R||N.numSpotMaps!==A||N.numLightProbes!==b)&&(s.directional.length=m,s.spot.length=d,s.rectArea.length=M,s.point.length=p,s.hemi.length=v,s.directionalShadow.length=T,s.directionalShadowMap.length=T,s.pointShadow.length=P,s.pointShadowMap.length=P,s.spotShadow.length=R,s.spotShadowMap.length=R,s.directionalShadowMatrix.length=T,s.pointShadowMatrix.length=P,s.spotLightMatrix.length=R+A-X,s.spotLightMap.length=A,s.numSpotLightShadowsWithMaps=X,s.numLightProbes=b,N.directionalLength=m,N.pointLength=p,N.spotLength=d,N.rectAreaLength=M,N.hemiLength=v,N.numDirectionalShadows=T,N.numPointShadows=P,N.numSpotShadows=R,N.numSpotMaps=A,N.numLightProbes=b,s.version=Qm++)}function c(h,u){let f=0,g=0,_=0,m=0,p=0,d=u.matrixWorldInverse;for(let M=0,v=h.length;M<v;M++){let T=h[M];if(T.isDirectionalLight){let P=s.directional[f];P.direction.setFromMatrixPosition(T.matrixWorld),r.setFromMatrixPosition(T.target.matrixWorld),P.direction.sub(r),P.direction.transformDirection(d),f++}else if(T.isSpotLight){let P=s.spot[_];P.position.setFromMatrixPosition(T.matrixWorld),P.position.applyMatrix4(d),P.direction.setFromMatrixPosition(T.matrixWorld),r.setFromMatrixPosition(T.target.matrixWorld),P.direction.sub(r),P.direction.transformDirection(d),_++}else if(T.isRectAreaLight){let P=s.rectArea[m];P.position.setFromMatrixPosition(T.matrixWorld),P.position.applyMatrix4(d),a.identity(),o.copy(T.matrixWorld),o.premultiply(d),a.extractRotation(o),P.halfWidth.set(T.width*.5,0,0),P.halfHeight.set(0,T.height*.5,0),P.halfWidth.applyMatrix4(a),P.halfHeight.applyMatrix4(a),m++}else if(T.isPointLight){let P=s.point[g];P.position.setFromMatrixPosition(T.matrixWorld),P.position.applyMatrix4(d),g++}else if(T.isHemisphereLight){let P=s.hemi[p];P.direction.setFromMatrixPosition(T.matrixWorld),P.direction.transformDirection(d),p++}}}return{setup:l,setupView:c,state:s}}function Ql(i,e){let t=new tg(i,e),n=[],s=[];function r(){n.length=0,s.length=0}function o(u){n.push(u)}function a(u){s.push(u)}function l(u){t.setup(n,u)}function c(u){t.setupView(n,u)}return{init:r,state:{lightsArray:n,shadowsArray:s,lights:t},setupLights:l,setupLightsView:c,pushLight:o,pushShadow:a}}function ng(i,e){let t=new WeakMap;function n(r,o=0){let a=t.get(r),l;return a===void 0?(l=new Ql(i,e),t.set(r,[l])):o>=a.length?(l=new Ql(i,e),a.push(l)):l=a[o],l}function s(){t=new WeakMap}return{get:n,dispose:s}}var Fa=class extends Gn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=$h,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Oa=class extends Gn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}},ig=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,sg=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function rg(i,e,t){let n=new ls,s=new De,r=new De,o=new _t,a=new Fa({depthPacking:Kh}),l=new Oa,c={},h=t.maxTextureSize,u={[Hn]:Rt,[Rt]:Hn,[wn]:wn},f=new on({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new De},radius:{value:4}},vertexShader:ig,fragmentShader:sg}),g=f.clone();g.defines.HORIZONTAL_PASS=1;let _=new Ot;_.setAttribute("position",new xt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let m=new ot(_,f),p=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=hc;let d=this.type;this.render=function(R,A,X){if(p.enabled===!1||p.autoUpdate===!1&&p.needsUpdate===!1||R.length===0)return;let b=i.getRenderTarget(),w=i.getActiveCubeFace(),N=i.getActiveMipmapLevel(),ee=i.state;ee.setBlending(Bn),ee.buffers.color.setClear(1,1,1,1),ee.buffers.depth.setTest(!0),ee.setScissorTest(!1);let ue=d!==Sn&&this.type===Sn,I=d===Sn&&this.type!==Sn;for(let U=0,q=R.length;U<q;U++){let Q=R[U],j=Q.shadow;if(j===void 0){console.warn("THREE.WebGLShadowMap:",Q,"has no shadow.");continue}if(j.autoUpdate===!1&&j.needsUpdate===!1)continue;s.copy(j.mapSize);let J=j.getFrameExtents();if(s.multiply(J),r.copy(j.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/J.x),s.x=r.x*J.x,j.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/J.y),s.y=r.y*J.y,j.mapSize.y=r.y)),j.map===null||ue===!0||I===!0){let re=this.type!==Sn?{minFilter:yt,magFilter:yt}:{};j.map!==null&&j.map.dispose(),j.map=new An(s.x,s.y,re),j.map.texture.name=Q.name+".shadowMap",j.camera.updateProjectionMatrix()}i.setRenderTarget(j.map),i.clear();let te=j.getViewportCount();for(let re=0;re<te;re++){let fe=j.getViewport(re);o.set(r.x*fe.x,r.y*fe.y,r.x*fe.z,r.y*fe.w),ee.viewport(o),j.updateMatrices(Q,re),n=j.getFrustum(),T(A,X,j.camera,Q,this.type)}j.isPointLightShadow!==!0&&this.type===Sn&&M(j,X),j.needsUpdate=!1}d=this.type,p.needsUpdate=!1,i.setRenderTarget(b,w,N)};function M(R,A){let X=e.update(m);f.defines.VSM_SAMPLES!==R.blurSamples&&(f.defines.VSM_SAMPLES=R.blurSamples,g.defines.VSM_SAMPLES=R.blurSamples,f.needsUpdate=!0,g.needsUpdate=!0),R.mapPass===null&&(R.mapPass=new An(s.x,s.y)),f.uniforms.shadow_pass.value=R.map.texture,f.uniforms.resolution.value=R.mapSize,f.uniforms.radius.value=R.radius,i.setRenderTarget(R.mapPass),i.clear(),i.renderBufferDirect(A,null,X,f,m,null),g.uniforms.shadow_pass.value=R.mapPass.texture,g.uniforms.resolution.value=R.mapSize,g.uniforms.radius.value=R.radius,i.setRenderTarget(R.map),i.clear(),i.renderBufferDirect(A,null,X,g,m,null)}function v(R,A,X,b){let w=null,N=X.isPointLight===!0?R.customDistanceMaterial:R.customDepthMaterial;if(N!==void 0)w=N;else if(w=X.isPointLight===!0?l:a,i.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0){let ee=w.uuid,ue=A.uuid,I=c[ee];I===void 0&&(I={},c[ee]=I);let U=I[ue];U===void 0&&(U=w.clone(),I[ue]=U,A.addEventListener("dispose",P)),w=U}if(w.visible=A.visible,w.wireframe=A.wireframe,b===Sn?w.side=A.shadowSide!==null?A.shadowSide:A.side:w.side=A.shadowSide!==null?A.shadowSide:u[A.side],w.alphaMap=A.alphaMap,w.alphaTest=A.alphaTest,w.map=A.map,w.clipShadows=A.clipShadows,w.clippingPlanes=A.clippingPlanes,w.clipIntersection=A.clipIntersection,w.displacementMap=A.displacementMap,w.displacementScale=A.displacementScale,w.displacementBias=A.displacementBias,w.wireframeLinewidth=A.wireframeLinewidth,w.linewidth=A.linewidth,X.isPointLight===!0&&w.isMeshDistanceMaterial===!0){let ee=i.properties.get(w);ee.light=X}return w}function T(R,A,X,b,w){if(R.visible===!1)return;if(R.layers.test(A.layers)&&(R.isMesh||R.isLine||R.isPoints)&&(R.castShadow||R.receiveShadow&&w===Sn)&&(!R.frustumCulled||n.intersectsObject(R))){R.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,R.matrixWorld);let ue=e.update(R),I=R.material;if(Array.isArray(I)){let U=ue.groups;for(let q=0,Q=U.length;q<Q;q++){let j=U[q],J=I[j.materialIndex];if(J&&J.visible){let te=v(R,J,b,w);R.onBeforeShadow(i,R,A,X,ue,te,j),i.renderBufferDirect(X,null,ue,te,R,j),R.onAfterShadow(i,R,A,X,ue,te,j)}}}else if(I.visible){let U=v(R,I,b,w);R.onBeforeShadow(i,R,A,X,ue,U,null),i.renderBufferDirect(X,null,ue,U,R,null),R.onAfterShadow(i,R,A,X,ue,U,null)}}let ee=R.children;for(let ue=0,I=ee.length;ue<I;ue++)T(ee[ue],A,X,b,w)}function P(R){R.target.removeEventListener("dispose",P);for(let X in c){let b=c[X],w=R.target.uuid;w in b&&(b[w].dispose(),delete b[w])}}}function ag(i,e,t){let n=t.isWebGL2;function s(){let C=!1,ae=new _t,le=null,Ce=new _t(0,0,0,0);return{setMask:function(we){le!==we&&!C&&(i.colorMask(we,we,we,we),le=we)},setLocked:function(we){C=we},setClear:function(we,Ye,Ze,pt,Lt){Lt===!0&&(we*=pt,Ye*=pt,Ze*=pt),ae.set(we,Ye,Ze,pt),Ce.equals(ae)===!1&&(i.clearColor(we,Ye,Ze,pt),Ce.copy(ae))},reset:function(){C=!1,le=null,Ce.set(-1,0,0,0)}}}function r(){let C=!1,ae=null,le=null,Ce=null;return{setTest:function(we){we?Ie(i.DEPTH_TEST):Ee(i.DEPTH_TEST)},setMask:function(we){ae!==we&&!C&&(i.depthMask(we),ae=we)},setFunc:function(we){if(le!==we){switch(we){case Ah:i.depthFunc(i.NEVER);break;case Rh:i.depthFunc(i.ALWAYS);break;case Ch:i.depthFunc(i.LESS);break;case Ys:i.depthFunc(i.LEQUAL);break;case Ph:i.depthFunc(i.EQUAL);break;case Lh:i.depthFunc(i.GEQUAL);break;case Ih:i.depthFunc(i.GREATER);break;case Dh:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}le=we}},setLocked:function(we){C=we},setClear:function(we){Ce!==we&&(i.clearDepth(we),Ce=we)},reset:function(){C=!1,ae=null,le=null,Ce=null}}}function o(){let C=!1,ae=null,le=null,Ce=null,we=null,Ye=null,Ze=null,pt=null,Lt=null;return{setTest:function(je){C||(je?Ie(i.STENCIL_TEST):Ee(i.STENCIL_TEST))},setMask:function(je){ae!==je&&!C&&(i.stencilMask(je),ae=je)},setFunc:function(je,It,un){(le!==je||Ce!==It||we!==un)&&(i.stencilFunc(je,It,un),le=je,Ce=It,we=un)},setOp:function(je,It,un){(Ye!==je||Ze!==It||pt!==un)&&(i.stencilOp(je,It,un),Ye=je,Ze=It,pt=un)},setLocked:function(je){C=je},setClear:function(je){Lt!==je&&(i.clearStencil(je),Lt=je)},reset:function(){C=!1,ae=null,le=null,Ce=null,we=null,Ye=null,Ze=null,pt=null,Lt=null}}}let a=new s,l=new r,c=new o,h=new WeakMap,u=new WeakMap,f={},g={},_=new WeakMap,m=[],p=null,d=!1,M=null,v=null,T=null,P=null,R=null,A=null,X=null,b=new Te(0,0,0),w=0,N=!1,ee=null,ue=null,I=null,U=null,q=null,Q=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),j=!1,J=0,te=i.getParameter(i.VERSION);te.indexOf("WebGL")!==-1?(J=parseFloat(/^WebGL (\d)/.exec(te)[1]),j=J>=1):te.indexOf("OpenGL ES")!==-1&&(J=parseFloat(/^OpenGL ES (\d)/.exec(te)[1]),j=J>=2);let re=null,fe={},H=i.getParameter(i.SCISSOR_BOX),ne=i.getParameter(i.VIEWPORT),de=new _t().fromArray(H),ge=new _t().fromArray(ne);function ye(C,ae,le,Ce){let we=new Uint8Array(4),Ye=i.createTexture();i.bindTexture(C,Ye),i.texParameteri(C,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(C,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ze=0;Ze<le;Ze++)n&&(C===i.TEXTURE_3D||C===i.TEXTURE_2D_ARRAY)?i.texImage3D(ae,0,i.RGBA,1,1,Ce,0,i.RGBA,i.UNSIGNED_BYTE,we):i.texImage2D(ae+Ze,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,we);return Ye}let Le={};Le[i.TEXTURE_2D]=ye(i.TEXTURE_2D,i.TEXTURE_2D,1),Le[i.TEXTURE_CUBE_MAP]=ye(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),n&&(Le[i.TEXTURE_2D_ARRAY]=ye(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),Le[i.TEXTURE_3D]=ye(i.TEXTURE_3D,i.TEXTURE_3D,1,1)),a.setClear(0,0,0,1),l.setClear(1),c.setClear(0),Ie(i.DEPTH_TEST),l.setFunc(Ys),G(!1),y(Io),Ie(i.CULL_FACE),Me(Bn);function Ie(C){f[C]!==!0&&(i.enable(C),f[C]=!0)}function Ee(C){f[C]!==!1&&(i.disable(C),f[C]=!1)}function ke(C,ae){return g[C]!==ae?(i.bindFramebuffer(C,ae),g[C]=ae,n&&(C===i.DRAW_FRAMEBUFFER&&(g[i.FRAMEBUFFER]=ae),C===i.FRAMEBUFFER&&(g[i.DRAW_FRAMEBUFFER]=ae)),!0):!1}function O(C,ae){let le=m,Ce=!1;if(C)if(le=_.get(ae),le===void 0&&(le=[],_.set(ae,le)),C.isWebGLMultipleRenderTargets){let we=C.texture;if(le.length!==we.length||le[0]!==i.COLOR_ATTACHMENT0){for(let Ye=0,Ze=we.length;Ye<Ze;Ye++)le[Ye]=i.COLOR_ATTACHMENT0+Ye;le.length=we.length,Ce=!0}}else le[0]!==i.COLOR_ATTACHMENT0&&(le[0]=i.COLOR_ATTACHMENT0,Ce=!0);else le[0]!==i.BACK&&(le[0]=i.BACK,Ce=!0);Ce&&(t.isWebGL2?i.drawBuffers(le):e.get("WEBGL_draw_buffers").drawBuffersWEBGL(le))}function Ke(C){return p!==C?(i.useProgram(C),p=C,!0):!1}let be={[Qn]:i.FUNC_ADD,[dh]:i.FUNC_SUBTRACT,[fh]:i.FUNC_REVERSE_SUBTRACT};if(n)be[Fo]=i.MIN,be[Oo]=i.MAX;else{let C=e.get("EXT_blend_minmax");C!==null&&(be[Fo]=C.MIN_EXT,be[Oo]=C.MAX_EXT)}let Pe={[ph]:i.ZERO,[mh]:i.ONE,[gh]:i.SRC_COLOR,[xa]:i.SRC_ALPHA,[bh]:i.SRC_ALPHA_SATURATE,[yh]:i.DST_COLOR,[xh]:i.DST_ALPHA,[_h]:i.ONE_MINUS_SRC_COLOR,[va]:i.ONE_MINUS_SRC_ALPHA,[Mh]:i.ONE_MINUS_DST_COLOR,[vh]:i.ONE_MINUS_DST_ALPHA,[Sh]:i.CONSTANT_COLOR,[wh]:i.ONE_MINUS_CONSTANT_COLOR,[Eh]:i.CONSTANT_ALPHA,[Th]:i.ONE_MINUS_CONSTANT_ALPHA};function Me(C,ae,le,Ce,we,Ye,Ze,pt,Lt,je){if(C===Bn){d===!0&&(Ee(i.BLEND),d=!1);return}if(d===!1&&(Ie(i.BLEND),d=!0),C!==uh){if(C!==M||je!==N){if((v!==Qn||R!==Qn)&&(i.blendEquation(i.FUNC_ADD),v=Qn,R=Qn),je)switch(C){case Li:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Do:i.blendFunc(i.ONE,i.ONE);break;case Uo:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case No:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",C);break}else switch(C){case Li:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Do:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case Uo:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case No:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",C);break}T=null,P=null,A=null,X=null,b.set(0,0,0),w=0,M=C,N=je}return}we=we||ae,Ye=Ye||le,Ze=Ze||Ce,(ae!==v||we!==R)&&(i.blendEquationSeparate(be[ae],be[we]),v=ae,R=we),(le!==T||Ce!==P||Ye!==A||Ze!==X)&&(i.blendFuncSeparate(Pe[le],Pe[Ce],Pe[Ye],Pe[Ze]),T=le,P=Ce,A=Ye,X=Ze),(pt.equals(b)===!1||Lt!==w)&&(i.blendColor(pt.r,pt.g,pt.b,Lt),b.copy(pt),w=Lt),M=C,N=!1}function W(C,ae){C.side===wn?Ee(i.CULL_FACE):Ie(i.CULL_FACE);let le=C.side===Rt;ae&&(le=!le),G(le),C.blending===Li&&C.transparent===!1?Me(Bn):Me(C.blending,C.blendEquation,C.blendSrc,C.blendDst,C.blendEquationAlpha,C.blendSrcAlpha,C.blendDstAlpha,C.blendColor,C.blendAlpha,C.premultipliedAlpha),l.setFunc(C.depthFunc),l.setTest(C.depthTest),l.setMask(C.depthWrite),a.setMask(C.colorWrite);let Ce=C.stencilWrite;c.setTest(Ce),Ce&&(c.setMask(C.stencilWriteMask),c.setFunc(C.stencilFunc,C.stencilRef,C.stencilFuncMask),c.setOp(C.stencilFail,C.stencilZFail,C.stencilZPass)),L(C.polygonOffset,C.polygonOffsetFactor,C.polygonOffsetUnits),C.alphaToCoverage===!0?Ie(i.SAMPLE_ALPHA_TO_COVERAGE):Ee(i.SAMPLE_ALPHA_TO_COVERAGE)}function G(C){ee!==C&&(C?i.frontFace(i.CW):i.frontFace(i.CCW),ee=C)}function y(C){C!==ch?(Ie(i.CULL_FACE),C!==ue&&(C===Io?i.cullFace(i.BACK):C===hh?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Ee(i.CULL_FACE),ue=C}function x(C){C!==I&&(j&&i.lineWidth(C),I=C)}function L(C,ae,le){C?(Ie(i.POLYGON_OFFSET_FILL),(U!==ae||q!==le)&&(i.polygonOffset(ae,le),U=ae,q=le)):Ee(i.POLYGON_OFFSET_FILL)}function Y(C){C?Ie(i.SCISSOR_TEST):Ee(i.SCISSOR_TEST)}function Z(C){C===void 0&&(C=i.TEXTURE0+Q-1),re!==C&&(i.activeTexture(C),re=C)}function B(C,ae,le){le===void 0&&(re===null?le=i.TEXTURE0+Q-1:le=re);let Ce=fe[le];Ce===void 0&&(Ce={type:void 0,texture:void 0},fe[le]=Ce),(Ce.type!==C||Ce.texture!==ae)&&(re!==le&&(i.activeTexture(le),re=le),i.bindTexture(C,ae||Le[C]),Ce.type=C,Ce.texture=ae)}function pe(){let C=fe[re];C!==void 0&&C.type!==void 0&&(i.bindTexture(C.type,null),C.type=void 0,C.texture=void 0)}function ce(){try{i.compressedTexImage2D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function he(){try{i.compressedTexImage3D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function _e(){try{i.texSubImage2D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function Re(){try{i.texSubImage3D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function $(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function xe(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function E(){try{i.texStorage2D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function K(){try{i.texStorage3D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function ie(){try{i.texImage2D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function se(){try{i.texImage3D.apply(i,arguments)}catch(C){console.error("THREE.WebGLState:",C)}}function Se(C){de.equals(C)===!1&&(i.scissor(C.x,C.y,C.z,C.w),de.copy(C))}function He(C){ge.equals(C)===!1&&(i.viewport(C.x,C.y,C.z,C.w),ge.copy(C))}function qe(C,ae){let le=u.get(ae);le===void 0&&(le=new WeakMap,u.set(ae,le));let Ce=le.get(C);Ce===void 0&&(Ce=i.getUniformBlockIndex(ae,C.name),le.set(C,Ce))}function Oe(C,ae){let Ce=u.get(ae).get(C);h.get(ae)!==Ce&&(i.uniformBlockBinding(ae,Ce,C.__bindingPointIndex),h.set(ae,Ce))}function oe(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),n===!0&&(i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null)),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),f={},re=null,fe={},g={},_=new WeakMap,m=[],p=null,d=!1,M=null,v=null,T=null,P=null,R=null,A=null,X=null,b=new Te(0,0,0),w=0,N=!1,ee=null,ue=null,I=null,U=null,q=null,de.set(0,0,i.canvas.width,i.canvas.height),ge.set(0,0,i.canvas.width,i.canvas.height),a.reset(),l.reset(),c.reset()}return{buffers:{color:a,depth:l,stencil:c},enable:Ie,disable:Ee,bindFramebuffer:ke,drawBuffers:O,useProgram:Ke,setBlending:Me,setMaterial:W,setFlipSided:G,setCullFace:y,setLineWidth:x,setPolygonOffset:L,setScissorTest:Y,activeTexture:Z,bindTexture:B,unbindTexture:pe,compressedTexImage2D:ce,compressedTexImage3D:he,texImage2D:ie,texImage3D:se,updateUBOMapping:qe,uniformBlockBinding:Oe,texStorage2D:E,texStorage3D:K,texSubImage2D:_e,texSubImage3D:Re,compressedTexSubImage2D:$,compressedTexSubImage3D:xe,scissor:Se,viewport:He,reset:oe}}function og(i,e,t,n,s,r,o){let a=s.isWebGL2,l=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new WeakMap,u,f=new WeakMap,g=!1;try{g=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(y,x){return g?new OffscreenCanvas(y,x):tr("canvas")}function m(y,x,L,Y){let Z=1;if((y.width>Y||y.height>Y)&&(Z=Y/Math.max(y.width,y.height)),Z<1||x===!0)if(typeof HTMLImageElement<"u"&&y instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&y instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&y instanceof ImageBitmap){let B=x?er:Math.floor,pe=B(Z*y.width),ce=B(Z*y.height);u===void 0&&(u=_(pe,ce));let he=L?_(pe,ce):u;return he.width=pe,he.height=ce,he.getContext("2d").drawImage(y,0,0,pe,ce),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+y.width+"x"+y.height+") to ("+pe+"x"+ce+")."),he}else return"data"in y&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+y.width+"x"+y.height+")."),y;return y}function p(y){return Ea(y.width)&&Ea(y.height)}function d(y){return a?!1:y.wrapS!==Ht||y.wrapT!==Ht||y.minFilter!==yt&&y.minFilter!==Nt}function M(y,x){return y.generateMipmaps&&x&&y.minFilter!==yt&&y.minFilter!==Nt}function v(y){i.generateMipmap(y)}function T(y,x,L,Y,Z=!1){if(a===!1)return x;if(y!==null){if(i[y]!==void 0)return i[y];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+y+"'")}let B=x;if(x===i.RED&&(L===i.FLOAT&&(B=i.R32F),L===i.HALF_FLOAT&&(B=i.R16F),L===i.UNSIGNED_BYTE&&(B=i.R8)),x===i.RED_INTEGER&&(L===i.UNSIGNED_BYTE&&(B=i.R8UI),L===i.UNSIGNED_SHORT&&(B=i.R16UI),L===i.UNSIGNED_INT&&(B=i.R32UI),L===i.BYTE&&(B=i.R8I),L===i.SHORT&&(B=i.R16I),L===i.INT&&(B=i.R32I)),x===i.RG&&(L===i.FLOAT&&(B=i.RG32F),L===i.HALF_FLOAT&&(B=i.RG16F),L===i.UNSIGNED_BYTE&&(B=i.RG8)),x===i.RGBA){let pe=Z?$s:$e.getTransfer(Y);L===i.FLOAT&&(B=i.RGBA32F),L===i.HALF_FLOAT&&(B=i.RGBA16F),L===i.UNSIGNED_BYTE&&(B=pe===et?i.SRGB8_ALPHA8:i.RGBA8),L===i.UNSIGNED_SHORT_4_4_4_4&&(B=i.RGBA4),L===i.UNSIGNED_SHORT_5_5_5_1&&(B=i.RGB5_A1)}return(B===i.R16F||B===i.R32F||B===i.RG16F||B===i.RG32F||B===i.RGBA16F||B===i.RGBA32F)&&e.get("EXT_color_buffer_float"),B}function P(y,x,L){return M(y,L)===!0||y.isFramebufferTexture&&y.minFilter!==yt&&y.minFilter!==Nt?Math.log2(Math.max(x.width,x.height))+1:y.mipmaps!==void 0&&y.mipmaps.length>0?y.mipmaps.length:y.isCompressedTexture&&Array.isArray(y.image)?x.mipmaps.length:1}function R(y){return y===yt||y===Bo||y===Hr?i.NEAREST:i.LINEAR}function A(y){let x=y.target;x.removeEventListener("dispose",A),b(x),x.isVideoTexture&&h.delete(x)}function X(y){let x=y.target;x.removeEventListener("dispose",X),N(x)}function b(y){let x=n.get(y);if(x.__webglInit===void 0)return;let L=y.source,Y=f.get(L);if(Y){let Z=Y[x.__cacheKey];Z.usedTimes--,Z.usedTimes===0&&w(y),Object.keys(Y).length===0&&f.delete(L)}n.remove(y)}function w(y){let x=n.get(y);i.deleteTexture(x.__webglTexture);let L=y.source,Y=f.get(L);delete Y[x.__cacheKey],o.memory.textures--}function N(y){let x=y.texture,L=n.get(y),Y=n.get(x);if(Y.__webglTexture!==void 0&&(i.deleteTexture(Y.__webglTexture),o.memory.textures--),y.depthTexture&&y.depthTexture.dispose(),y.isWebGLCubeRenderTarget)for(let Z=0;Z<6;Z++){if(Array.isArray(L.__webglFramebuffer[Z]))for(let B=0;B<L.__webglFramebuffer[Z].length;B++)i.deleteFramebuffer(L.__webglFramebuffer[Z][B]);else i.deleteFramebuffer(L.__webglFramebuffer[Z]);L.__webglDepthbuffer&&i.deleteRenderbuffer(L.__webglDepthbuffer[Z])}else{if(Array.isArray(L.__webglFramebuffer))for(let Z=0;Z<L.__webglFramebuffer.length;Z++)i.deleteFramebuffer(L.__webglFramebuffer[Z]);else i.deleteFramebuffer(L.__webglFramebuffer);if(L.__webglDepthbuffer&&i.deleteRenderbuffer(L.__webglDepthbuffer),L.__webglMultisampledFramebuffer&&i.deleteFramebuffer(L.__webglMultisampledFramebuffer),L.__webglColorRenderbuffer)for(let Z=0;Z<L.__webglColorRenderbuffer.length;Z++)L.__webglColorRenderbuffer[Z]&&i.deleteRenderbuffer(L.__webglColorRenderbuffer[Z]);L.__webglDepthRenderbuffer&&i.deleteRenderbuffer(L.__webglDepthRenderbuffer)}if(y.isWebGLMultipleRenderTargets)for(let Z=0,B=x.length;Z<B;Z++){let pe=n.get(x[Z]);pe.__webglTexture&&(i.deleteTexture(pe.__webglTexture),o.memory.textures--),n.remove(x[Z])}n.remove(x),n.remove(y)}let ee=0;function ue(){ee=0}function I(){let y=ee;return y>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+y+" texture units while this GPU supports only "+s.maxTextures),ee+=1,y}function U(y){let x=[];return x.push(y.wrapS),x.push(y.wrapT),x.push(y.wrapR||0),x.push(y.magFilter),x.push(y.minFilter),x.push(y.anisotropy),x.push(y.internalFormat),x.push(y.format),x.push(y.type),x.push(y.generateMipmaps),x.push(y.premultiplyAlpha),x.push(y.flipY),x.push(y.unpackAlignment),x.push(y.colorSpace),x.join()}function q(y,x){let L=n.get(y);if(y.isVideoTexture&&W(y),y.isRenderTargetTexture===!1&&y.version>0&&L.__version!==y.version){let Y=y.image;if(Y===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(Y.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{de(L,y,x);return}}t.bindTexture(i.TEXTURE_2D,L.__webglTexture,i.TEXTURE0+x)}function Q(y,x){let L=n.get(y);if(y.version>0&&L.__version!==y.version){de(L,y,x);return}t.bindTexture(i.TEXTURE_2D_ARRAY,L.__webglTexture,i.TEXTURE0+x)}function j(y,x){let L=n.get(y);if(y.version>0&&L.__version!==y.version){de(L,y,x);return}t.bindTexture(i.TEXTURE_3D,L.__webglTexture,i.TEXTURE0+x)}function J(y,x){let L=n.get(y);if(y.version>0&&L.__version!==y.version){ge(L,y,x);return}t.bindTexture(i.TEXTURE_CUBE_MAP,L.__webglTexture,i.TEXTURE0+x)}let te={[ba]:i.REPEAT,[Ht]:i.CLAMP_TO_EDGE,[Sa]:i.MIRRORED_REPEAT},re={[yt]:i.NEAREST,[Bo]:i.NEAREST_MIPMAP_NEAREST,[Hr]:i.NEAREST_MIPMAP_LINEAR,[Nt]:i.LINEAR,[Hh]:i.LINEAR_MIPMAP_NEAREST,[rs]:i.LINEAR_MIPMAP_LINEAR},fe={[Qh]:i.NEVER,[ru]:i.ALWAYS,[eu]:i.LESS,[bc]:i.LEQUAL,[tu]:i.EQUAL,[su]:i.GEQUAL,[nu]:i.GREATER,[iu]:i.NOTEQUAL};function H(y,x,L){if(L?(i.texParameteri(y,i.TEXTURE_WRAP_S,te[x.wrapS]),i.texParameteri(y,i.TEXTURE_WRAP_T,te[x.wrapT]),(y===i.TEXTURE_3D||y===i.TEXTURE_2D_ARRAY)&&i.texParameteri(y,i.TEXTURE_WRAP_R,te[x.wrapR]),i.texParameteri(y,i.TEXTURE_MAG_FILTER,re[x.magFilter]),i.texParameteri(y,i.TEXTURE_MIN_FILTER,re[x.minFilter])):(i.texParameteri(y,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(y,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),(y===i.TEXTURE_3D||y===i.TEXTURE_2D_ARRAY)&&i.texParameteri(y,i.TEXTURE_WRAP_R,i.CLAMP_TO_EDGE),(x.wrapS!==Ht||x.wrapT!==Ht)&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping."),i.texParameteri(y,i.TEXTURE_MAG_FILTER,R(x.magFilter)),i.texParameteri(y,i.TEXTURE_MIN_FILTER,R(x.minFilter)),x.minFilter!==yt&&x.minFilter!==Nt&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter.")),x.compareFunction&&(i.texParameteri(y,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(y,i.TEXTURE_COMPARE_FUNC,fe[x.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){let Y=e.get("EXT_texture_filter_anisotropic");if(x.magFilter===yt||x.minFilter!==Hr&&x.minFilter!==rs||x.type===On&&e.has("OES_texture_float_linear")===!1||a===!1&&x.type===as&&e.has("OES_texture_half_float_linear")===!1)return;(x.anisotropy>1||n.get(x).__currentAnisotropy)&&(i.texParameterf(y,Y.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(x.anisotropy,s.getMaxAnisotropy())),n.get(x).__currentAnisotropy=x.anisotropy)}}function ne(y,x){let L=!1;y.__webglInit===void 0&&(y.__webglInit=!0,x.addEventListener("dispose",A));let Y=x.source,Z=f.get(Y);Z===void 0&&(Z={},f.set(Y,Z));let B=U(x);if(B!==y.__cacheKey){Z[B]===void 0&&(Z[B]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,L=!0),Z[B].usedTimes++;let pe=Z[y.__cacheKey];pe!==void 0&&(Z[y.__cacheKey].usedTimes--,pe.usedTimes===0&&w(x)),y.__cacheKey=B,y.__webglTexture=Z[B].texture}return L}function de(y,x,L){let Y=i.TEXTURE_2D;(x.isDataArrayTexture||x.isCompressedArrayTexture)&&(Y=i.TEXTURE_2D_ARRAY),x.isData3DTexture&&(Y=i.TEXTURE_3D);let Z=ne(y,x),B=x.source;t.bindTexture(Y,y.__webglTexture,i.TEXTURE0+L);let pe=n.get(B);if(B.version!==pe.__version||Z===!0){t.activeTexture(i.TEXTURE0+L);let ce=$e.getPrimaries($e.workingColorSpace),he=x.colorSpace===Kt?null:$e.getPrimaries(x.colorSpace),_e=x.colorSpace===Kt||ce===he?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,_e);let Re=d(x)&&p(x.image)===!1,$=m(x.image,Re,!1,s.maxTextureSize);$=G(x,$);let xe=p($)||a,E=r.convert(x.format,x.colorSpace),K=r.convert(x.type),ie=T(x.internalFormat,E,K,x.colorSpace,x.isVideoTexture);H(Y,x,xe);let se,Se=x.mipmaps,He=a&&x.isVideoTexture!==!0&&ie!==vc,qe=pe.__version===void 0||Z===!0,Oe=P(x,$,xe);if(x.isDepthTexture)ie=i.DEPTH_COMPONENT,a?x.type===On?ie=i.DEPTH_COMPONENT32F:x.type===Fn?ie=i.DEPTH_COMPONENT24:x.type===ti?ie=i.DEPTH24_STENCIL8:ie=i.DEPTH_COMPONENT16:x.type===On&&console.error("WebGLRenderer: Floating point depth texture requires WebGL2."),x.format===ni&&ie===i.DEPTH_COMPONENT&&x.type!==so&&x.type!==Fn&&(console.warn("THREE.WebGLRenderer: Use UnsignedShortType or UnsignedIntType for DepthFormat DepthTexture."),x.type=Fn,K=r.convert(x.type)),x.format===Fi&&ie===i.DEPTH_COMPONENT&&(ie=i.DEPTH_STENCIL,x.type!==ti&&(console.warn("THREE.WebGLRenderer: Use UnsignedInt248Type for DepthStencilFormat DepthTexture."),x.type=ti,K=r.convert(x.type))),qe&&(He?t.texStorage2D(i.TEXTURE_2D,1,ie,$.width,$.height):t.texImage2D(i.TEXTURE_2D,0,ie,$.width,$.height,0,E,K,null));else if(x.isDataTexture)if(Se.length>0&&xe){He&&qe&&t.texStorage2D(i.TEXTURE_2D,Oe,ie,Se[0].width,Se[0].height);for(let oe=0,C=Se.length;oe<C;oe++)se=Se[oe],He?t.texSubImage2D(i.TEXTURE_2D,oe,0,0,se.width,se.height,E,K,se.data):t.texImage2D(i.TEXTURE_2D,oe,ie,se.width,se.height,0,E,K,se.data);x.generateMipmaps=!1}else He?(qe&&t.texStorage2D(i.TEXTURE_2D,Oe,ie,$.width,$.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,$.width,$.height,E,K,$.data)):t.texImage2D(i.TEXTURE_2D,0,ie,$.width,$.height,0,E,K,$.data);else if(x.isCompressedTexture)if(x.isCompressedArrayTexture){He&&qe&&t.texStorage3D(i.TEXTURE_2D_ARRAY,Oe,ie,Se[0].width,Se[0].height,$.depth);for(let oe=0,C=Se.length;oe<C;oe++)se=Se[oe],x.format!==Xt?E!==null?He?t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,oe,0,0,0,se.width,se.height,$.depth,E,se.data,0,0):t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,oe,ie,se.width,se.height,$.depth,0,se.data,0,0):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):He?t.texSubImage3D(i.TEXTURE_2D_ARRAY,oe,0,0,0,se.width,se.height,$.depth,E,K,se.data):t.texImage3D(i.TEXTURE_2D_ARRAY,oe,ie,se.width,se.height,$.depth,0,E,K,se.data)}else{He&&qe&&t.texStorage2D(i.TEXTURE_2D,Oe,ie,Se[0].width,Se[0].height);for(let oe=0,C=Se.length;oe<C;oe++)se=Se[oe],x.format!==Xt?E!==null?He?t.compressedTexSubImage2D(i.TEXTURE_2D,oe,0,0,se.width,se.height,E,se.data):t.compressedTexImage2D(i.TEXTURE_2D,oe,ie,se.width,se.height,0,se.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):He?t.texSubImage2D(i.TEXTURE_2D,oe,0,0,se.width,se.height,E,K,se.data):t.texImage2D(i.TEXTURE_2D,oe,ie,se.width,se.height,0,E,K,se.data)}else if(x.isDataArrayTexture)He?(qe&&t.texStorage3D(i.TEXTURE_2D_ARRAY,Oe,ie,$.width,$.height,$.depth),t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,$.width,$.height,$.depth,E,K,$.data)):t.texImage3D(i.TEXTURE_2D_ARRAY,0,ie,$.width,$.height,$.depth,0,E,K,$.data);else if(x.isData3DTexture)He?(qe&&t.texStorage3D(i.TEXTURE_3D,Oe,ie,$.width,$.height,$.depth),t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,$.width,$.height,$.depth,E,K,$.data)):t.texImage3D(i.TEXTURE_3D,0,ie,$.width,$.height,$.depth,0,E,K,$.data);else if(x.isFramebufferTexture){if(qe)if(He)t.texStorage2D(i.TEXTURE_2D,Oe,ie,$.width,$.height);else{let oe=$.width,C=$.height;for(let ae=0;ae<Oe;ae++)t.texImage2D(i.TEXTURE_2D,ae,ie,oe,C,0,E,K,null),oe>>=1,C>>=1}}else if(Se.length>0&&xe){He&&qe&&t.texStorage2D(i.TEXTURE_2D,Oe,ie,Se[0].width,Se[0].height);for(let oe=0,C=Se.length;oe<C;oe++)se=Se[oe],He?t.texSubImage2D(i.TEXTURE_2D,oe,0,0,E,K,se):t.texImage2D(i.TEXTURE_2D,oe,ie,E,K,se);x.generateMipmaps=!1}else He?(qe&&t.texStorage2D(i.TEXTURE_2D,Oe,ie,$.width,$.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,E,K,$)):t.texImage2D(i.TEXTURE_2D,0,ie,E,K,$);M(x,xe)&&v(Y),pe.__version=B.version,x.onUpdate&&x.onUpdate(x)}y.__version=x.version}function ge(y,x,L){if(x.image.length!==6)return;let Y=ne(y,x),Z=x.source;t.bindTexture(i.TEXTURE_CUBE_MAP,y.__webglTexture,i.TEXTURE0+L);let B=n.get(Z);if(Z.version!==B.__version||Y===!0){t.activeTexture(i.TEXTURE0+L);let pe=$e.getPrimaries($e.workingColorSpace),ce=x.colorSpace===Kt?null:$e.getPrimaries(x.colorSpace),he=x.colorSpace===Kt||pe===ce?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,he);let _e=x.isCompressedTexture||x.image[0].isCompressedTexture,Re=x.image[0]&&x.image[0].isDataTexture,$=[];for(let oe=0;oe<6;oe++)!_e&&!Re?$[oe]=m(x.image[oe],!1,!0,s.maxCubemapSize):$[oe]=Re?x.image[oe].image:x.image[oe],$[oe]=G(x,$[oe]);let xe=$[0],E=p(xe)||a,K=r.convert(x.format,x.colorSpace),ie=r.convert(x.type),se=T(x.internalFormat,K,ie,x.colorSpace),Se=a&&x.isVideoTexture!==!0,He=B.__version===void 0||Y===!0,qe=P(x,xe,E);H(i.TEXTURE_CUBE_MAP,x,E);let Oe;if(_e){Se&&He&&t.texStorage2D(i.TEXTURE_CUBE_MAP,qe,se,xe.width,xe.height);for(let oe=0;oe<6;oe++){Oe=$[oe].mipmaps;for(let C=0;C<Oe.length;C++){let ae=Oe[C];x.format!==Xt?K!==null?Se?t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C,0,0,ae.width,ae.height,K,ae.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C,se,ae.width,ae.height,0,ae.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C,0,0,ae.width,ae.height,K,ie,ae.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C,se,ae.width,ae.height,0,K,ie,ae.data)}}}else{Oe=x.mipmaps,Se&&He&&(Oe.length>0&&qe++,t.texStorage2D(i.TEXTURE_CUBE_MAP,qe,se,$[0].width,$[0].height));for(let oe=0;oe<6;oe++)if(Re){Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,$[oe].width,$[oe].height,K,ie,$[oe].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,se,$[oe].width,$[oe].height,0,K,ie,$[oe].data);for(let C=0;C<Oe.length;C++){let le=Oe[C].image[oe].image;Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C+1,0,0,le.width,le.height,K,ie,le.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C+1,se,le.width,le.height,0,K,ie,le.data)}}else{Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,0,0,K,ie,$[oe]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0,se,K,ie,$[oe]);for(let C=0;C<Oe.length;C++){let ae=Oe[C];Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C+1,0,0,K,ie,ae.image[oe]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,C+1,se,K,ie,ae.image[oe])}}}M(x,E)&&v(i.TEXTURE_CUBE_MAP),B.__version=Z.version,x.onUpdate&&x.onUpdate(x)}y.__version=x.version}function ye(y,x,L,Y,Z,B){let pe=r.convert(L.format,L.colorSpace),ce=r.convert(L.type),he=T(L.internalFormat,pe,ce,L.colorSpace);if(!n.get(x).__hasExternalTextures){let Re=Math.max(1,x.width>>B),$=Math.max(1,x.height>>B);Z===i.TEXTURE_3D||Z===i.TEXTURE_2D_ARRAY?t.texImage3D(Z,B,he,Re,$,x.depth,0,pe,ce,null):t.texImage2D(Z,B,he,Re,$,0,pe,ce,null)}t.bindFramebuffer(i.FRAMEBUFFER,y),Me(x)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,Y,Z,n.get(L).__webglTexture,0,Pe(x)):(Z===i.TEXTURE_2D||Z>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&Z<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,Y,Z,n.get(L).__webglTexture,B),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Le(y,x,L){if(i.bindRenderbuffer(i.RENDERBUFFER,y),x.depthBuffer&&!x.stencilBuffer){let Y=a===!0?i.DEPTH_COMPONENT24:i.DEPTH_COMPONENT16;if(L||Me(x)){let Z=x.depthTexture;Z&&Z.isDepthTexture&&(Z.type===On?Y=i.DEPTH_COMPONENT32F:Z.type===Fn&&(Y=i.DEPTH_COMPONENT24));let B=Pe(x);Me(x)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,B,Y,x.width,x.height):i.renderbufferStorageMultisample(i.RENDERBUFFER,B,Y,x.width,x.height)}else i.renderbufferStorage(i.RENDERBUFFER,Y,x.width,x.height);i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.RENDERBUFFER,y)}else if(x.depthBuffer&&x.stencilBuffer){let Y=Pe(x);L&&Me(x)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Y,i.DEPTH24_STENCIL8,x.width,x.height):Me(x)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Y,i.DEPTH24_STENCIL8,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,i.DEPTH_STENCIL,x.width,x.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.RENDERBUFFER,y)}else{let Y=x.isWebGLMultipleRenderTargets===!0?x.texture:[x.texture];for(let Z=0;Z<Y.length;Z++){let B=Y[Z],pe=r.convert(B.format,B.colorSpace),ce=r.convert(B.type),he=T(B.internalFormat,pe,ce,B.colorSpace),_e=Pe(x);L&&Me(x)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,_e,he,x.width,x.height):Me(x)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,_e,he,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,he,x.width,x.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ie(y,x){if(x&&x.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,y),!(x.depthTexture&&x.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(x.depthTexture).__webglTexture||x.depthTexture.image.width!==x.width||x.depthTexture.image.height!==x.height)&&(x.depthTexture.image.width=x.width,x.depthTexture.image.height=x.height,x.depthTexture.needsUpdate=!0),q(x.depthTexture,0);let Y=n.get(x.depthTexture).__webglTexture,Z=Pe(x);if(x.depthTexture.format===ni)Me(x)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Y,0,Z):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Y,0);else if(x.depthTexture.format===Fi)Me(x)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Y,0,Z):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Y,0);else throw new Error("Unknown depthTexture format")}function Ee(y){let x=n.get(y),L=y.isWebGLCubeRenderTarget===!0;if(y.depthTexture&&!x.__autoAllocateDepthBuffer){if(L)throw new Error("target.depthTexture not supported in Cube render targets");Ie(x.__webglFramebuffer,y)}else if(L){x.__webglDepthbuffer=[];for(let Y=0;Y<6;Y++)t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer[Y]),x.__webglDepthbuffer[Y]=i.createRenderbuffer(),Le(x.__webglDepthbuffer[Y],y,!1)}else t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer),x.__webglDepthbuffer=i.createRenderbuffer(),Le(x.__webglDepthbuffer,y,!1);t.bindFramebuffer(i.FRAMEBUFFER,null)}function ke(y,x,L){let Y=n.get(y);x!==void 0&&ye(Y.__webglFramebuffer,y,y.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),L!==void 0&&Ee(y)}function O(y){let x=y.texture,L=n.get(y),Y=n.get(x);y.addEventListener("dispose",X),y.isWebGLMultipleRenderTargets!==!0&&(Y.__webglTexture===void 0&&(Y.__webglTexture=i.createTexture()),Y.__version=x.version,o.memory.textures++);let Z=y.isWebGLCubeRenderTarget===!0,B=y.isWebGLMultipleRenderTargets===!0,pe=p(y)||a;if(Z){L.__webglFramebuffer=[];for(let ce=0;ce<6;ce++)if(a&&x.mipmaps&&x.mipmaps.length>0){L.__webglFramebuffer[ce]=[];for(let he=0;he<x.mipmaps.length;he++)L.__webglFramebuffer[ce][he]=i.createFramebuffer()}else L.__webglFramebuffer[ce]=i.createFramebuffer()}else{if(a&&x.mipmaps&&x.mipmaps.length>0){L.__webglFramebuffer=[];for(let ce=0;ce<x.mipmaps.length;ce++)L.__webglFramebuffer[ce]=i.createFramebuffer()}else L.__webglFramebuffer=i.createFramebuffer();if(B)if(s.drawBuffers){let ce=y.texture;for(let he=0,_e=ce.length;he<_e;he++){let Re=n.get(ce[he]);Re.__webglTexture===void 0&&(Re.__webglTexture=i.createTexture(),o.memory.textures++)}}else console.warn("THREE.WebGLRenderer: WebGLMultipleRenderTargets can only be used with WebGL2 or WEBGL_draw_buffers extension.");if(a&&y.samples>0&&Me(y)===!1){let ce=B?x:[x];L.__webglMultisampledFramebuffer=i.createFramebuffer(),L.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,L.__webglMultisampledFramebuffer);for(let he=0;he<ce.length;he++){let _e=ce[he];L.__webglColorRenderbuffer[he]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,L.__webglColorRenderbuffer[he]);let Re=r.convert(_e.format,_e.colorSpace),$=r.convert(_e.type),xe=T(_e.internalFormat,Re,$,_e.colorSpace,y.isXRRenderTarget===!0),E=Pe(y);i.renderbufferStorageMultisample(i.RENDERBUFFER,E,xe,y.width,y.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+he,i.RENDERBUFFER,L.__webglColorRenderbuffer[he])}i.bindRenderbuffer(i.RENDERBUFFER,null),y.depthBuffer&&(L.__webglDepthRenderbuffer=i.createRenderbuffer(),Le(L.__webglDepthRenderbuffer,y,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(Z){t.bindTexture(i.TEXTURE_CUBE_MAP,Y.__webglTexture),H(i.TEXTURE_CUBE_MAP,x,pe);for(let ce=0;ce<6;ce++)if(a&&x.mipmaps&&x.mipmaps.length>0)for(let he=0;he<x.mipmaps.length;he++)ye(L.__webglFramebuffer[ce][he],y,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,he);else ye(L.__webglFramebuffer[ce],y,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0);M(x,pe)&&v(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(B){let ce=y.texture;for(let he=0,_e=ce.length;he<_e;he++){let Re=ce[he],$=n.get(Re);t.bindTexture(i.TEXTURE_2D,$.__webglTexture),H(i.TEXTURE_2D,Re,pe),ye(L.__webglFramebuffer,y,Re,i.COLOR_ATTACHMENT0+he,i.TEXTURE_2D,0),M(Re,pe)&&v(i.TEXTURE_2D)}t.unbindTexture()}else{let ce=i.TEXTURE_2D;if((y.isWebGL3DRenderTarget||y.isWebGLArrayRenderTarget)&&(a?ce=y.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY:console.error("THREE.WebGLTextures: THREE.Data3DTexture and THREE.DataArrayTexture only supported with WebGL2.")),t.bindTexture(ce,Y.__webglTexture),H(ce,x,pe),a&&x.mipmaps&&x.mipmaps.length>0)for(let he=0;he<x.mipmaps.length;he++)ye(L.__webglFramebuffer[he],y,x,i.COLOR_ATTACHMENT0,ce,he);else ye(L.__webglFramebuffer,y,x,i.COLOR_ATTACHMENT0,ce,0);M(x,pe)&&v(ce),t.unbindTexture()}y.depthBuffer&&Ee(y)}function Ke(y){let x=p(y)||a,L=y.isWebGLMultipleRenderTargets===!0?y.texture:[y.texture];for(let Y=0,Z=L.length;Y<Z;Y++){let B=L[Y];if(M(B,x)){let pe=y.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,ce=n.get(B).__webglTexture;t.bindTexture(pe,ce),v(pe),t.unbindTexture()}}}function be(y){if(a&&y.samples>0&&Me(y)===!1){let x=y.isWebGLMultipleRenderTargets?y.texture:[y.texture],L=y.width,Y=y.height,Z=i.COLOR_BUFFER_BIT,B=[],pe=y.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ce=n.get(y),he=y.isWebGLMultipleRenderTargets===!0;if(he)for(let _e=0;_e<x.length;_e++)t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+_e,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+_e,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,ce.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ce.__webglFramebuffer);for(let _e=0;_e<x.length;_e++){B.push(i.COLOR_ATTACHMENT0+_e),y.depthBuffer&&B.push(pe);let Re=ce.__ignoreDepthValues!==void 0?ce.__ignoreDepthValues:!1;if(Re===!1&&(y.depthBuffer&&(Z|=i.DEPTH_BUFFER_BIT),y.stencilBuffer&&(Z|=i.STENCIL_BUFFER_BIT)),he&&i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,ce.__webglColorRenderbuffer[_e]),Re===!0&&(i.invalidateFramebuffer(i.READ_FRAMEBUFFER,[pe]),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[pe])),he){let $=n.get(x[_e]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,$,0)}i.blitFramebuffer(0,0,L,Y,0,0,L,Y,Z,i.NEAREST),c&&i.invalidateFramebuffer(i.READ_FRAMEBUFFER,B)}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),he)for(let _e=0;_e<x.length;_e++){t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+_e,i.RENDERBUFFER,ce.__webglColorRenderbuffer[_e]);let Re=n.get(x[_e]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,ce.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+_e,i.TEXTURE_2D,Re,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ce.__webglMultisampledFramebuffer)}}function Pe(y){return Math.min(s.maxSamples,y.samples)}function Me(y){let x=n.get(y);return a&&y.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&x.__useRenderToTexture!==!1}function W(y){let x=o.render.frame;h.get(y)!==x&&(h.set(y,x),y.update())}function G(y,x){let L=y.colorSpace,Y=y.format,Z=y.type;return y.isCompressedTexture===!0||y.isVideoTexture===!0||y.format===wa||L!==Tn&&L!==Kt&&($e.getTransfer(L)===et?a===!1?e.has("EXT_sRGB")===!0&&Y===Xt?(y.format=wa,y.minFilter=Nt,y.generateMipmaps=!1):x=nr.sRGBToLinear(x):(Y!==Xt||Z!==kn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",L)),x}this.allocateTextureUnit=I,this.resetTextureUnits=ue,this.setTexture2D=q,this.setTexture2DArray=Q,this.setTexture3D=j,this.setTextureCube=J,this.rebindTextures=ke,this.setupRenderTarget=O,this.updateRenderTargetMipmap=Ke,this.updateMultisampleRenderTarget=be,this.setupDepthRenderbuffer=Ee,this.setupFrameBufferTexture=ye,this.useMultisampledRTT=Me}function lg(i,e,t){let n=t.isWebGL2;function s(r,o=Kt){let a,l=$e.getTransfer(o);if(r===kn)return i.UNSIGNED_BYTE;if(r===pc)return i.UNSIGNED_SHORT_4_4_4_4;if(r===mc)return i.UNSIGNED_SHORT_5_5_5_1;if(r===Vh)return i.BYTE;if(r===Gh)return i.SHORT;if(r===so)return i.UNSIGNED_SHORT;if(r===fc)return i.INT;if(r===Fn)return i.UNSIGNED_INT;if(r===On)return i.FLOAT;if(r===as)return n?i.HALF_FLOAT:(a=e.get("OES_texture_half_float"),a!==null?a.HALF_FLOAT_OES:null);if(r===Wh)return i.ALPHA;if(r===Xt)return i.RGBA;if(r===Xh)return i.LUMINANCE;if(r===qh)return i.LUMINANCE_ALPHA;if(r===ni)return i.DEPTH_COMPONENT;if(r===Fi)return i.DEPTH_STENCIL;if(r===wa)return a=e.get("EXT_sRGB"),a!==null?a.SRGB_ALPHA_EXT:null;if(r===Yh)return i.RED;if(r===gc)return i.RED_INTEGER;if(r===Zh)return i.RG;if(r===_c)return i.RG_INTEGER;if(r===xc)return i.RGBA_INTEGER;if(r===Vr||r===Gr||r===Wr||r===Xr)if(l===et)if(a=e.get("WEBGL_compressed_texture_s3tc_srgb"),a!==null){if(r===Vr)return a.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(r===Gr)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(r===Wr)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(r===Xr)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(a=e.get("WEBGL_compressed_texture_s3tc"),a!==null){if(r===Vr)return a.COMPRESSED_RGB_S3TC_DXT1_EXT;if(r===Gr)return a.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(r===Wr)return a.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(r===Xr)return a.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(r===zo||r===ko||r===Ho||r===Vo)if(a=e.get("WEBGL_compressed_texture_pvrtc"),a!==null){if(r===zo)return a.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(r===ko)return a.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(r===Ho)return a.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(r===Vo)return a.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(r===vc)return a=e.get("WEBGL_compressed_texture_etc1"),a!==null?a.COMPRESSED_RGB_ETC1_WEBGL:null;if(r===Go||r===Wo)if(a=e.get("WEBGL_compressed_texture_etc"),a!==null){if(r===Go)return l===et?a.COMPRESSED_SRGB8_ETC2:a.COMPRESSED_RGB8_ETC2;if(r===Wo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:a.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(r===Xo||r===qo||r===Yo||r===Zo||r===Jo||r===$o||r===Ko||r===jo||r===Qo||r===el||r===tl||r===nl||r===il||r===sl)if(a=e.get("WEBGL_compressed_texture_astc"),a!==null){if(r===Xo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:a.COMPRESSED_RGBA_ASTC_4x4_KHR;if(r===qo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:a.COMPRESSED_RGBA_ASTC_5x4_KHR;if(r===Yo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:a.COMPRESSED_RGBA_ASTC_5x5_KHR;if(r===Zo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:a.COMPRESSED_RGBA_ASTC_6x5_KHR;if(r===Jo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:a.COMPRESSED_RGBA_ASTC_6x6_KHR;if(r===$o)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:a.COMPRESSED_RGBA_ASTC_8x5_KHR;if(r===Ko)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:a.COMPRESSED_RGBA_ASTC_8x6_KHR;if(r===jo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:a.COMPRESSED_RGBA_ASTC_8x8_KHR;if(r===Qo)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:a.COMPRESSED_RGBA_ASTC_10x5_KHR;if(r===el)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:a.COMPRESSED_RGBA_ASTC_10x6_KHR;if(r===tl)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:a.COMPRESSED_RGBA_ASTC_10x8_KHR;if(r===nl)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:a.COMPRESSED_RGBA_ASTC_10x10_KHR;if(r===il)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:a.COMPRESSED_RGBA_ASTC_12x10_KHR;if(r===sl)return l===et?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:a.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(r===qr||r===rl||r===al)if(a=e.get("EXT_texture_compression_bptc"),a!==null){if(r===qr)return l===et?a.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:a.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(r===rl)return a.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(r===al)return a.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(r===Jh||r===ol||r===ll||r===cl)if(a=e.get("EXT_texture_compression_rgtc"),a!==null){if(r===qr)return a.COMPRESSED_RED_RGTC1_EXT;if(r===ol)return a.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(r===ll)return a.COMPRESSED_RED_GREEN_RGTC2_EXT;if(r===cl)return a.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return r===ti?n?i.UNSIGNED_INT_24_8:(a=e.get("WEBGL_depth_texture"),a!==null?a.UNSIGNED_INT_24_8_WEBGL:null):i[r]!==void 0?i[r]:null}return{convert:s}}var Ba=class extends Ft{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}},jt=class extends ht{constructor(){super(),this.isGroup=!0,this.type="Group"}},cg={type:"move"},ss=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new jt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new jt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new D,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new D),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new jt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new D,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new D),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let m of e.hand.values()){let p=t.getJointPose(m,n),d=this._getHandJoint(c,m);p!==null&&(d.matrix.fromArray(p.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,d.jointRadius=p.radius),d.visible=p!==null}let h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],f=h.position.distanceTo(u.position),g=.02,_=.005;c.inputState.pinching&&f>g+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&f<=g-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(cg)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new jt;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},za=class extends fn{constructor(e,t){super();let n=this,s=null,r=1,o=null,a="local-floor",l=1,c=null,h=null,u=null,f=null,g=null,_=null,m=t.getContextAttributes(),p=null,d=null,M=[],v=[],T=new De,P=null,R=new Ft;R.layers.enable(1),R.viewport=new _t;let A=new Ft;A.layers.enable(2),A.viewport=new _t;let X=[R,A],b=new Ba;b.layers.enable(1),b.layers.enable(2);let w=null,N=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(H){let ne=M[H];return ne===void 0&&(ne=new ss,M[H]=ne),ne.getTargetRaySpace()},this.getControllerGrip=function(H){let ne=M[H];return ne===void 0&&(ne=new ss,M[H]=ne),ne.getGripSpace()},this.getHand=function(H){let ne=M[H];return ne===void 0&&(ne=new ss,M[H]=ne),ne.getHandSpace()};function ee(H){let ne=v.indexOf(H.inputSource);if(ne===-1)return;let de=M[ne];de!==void 0&&(de.update(H.inputSource,H.frame,c||o),de.dispatchEvent({type:H.type,data:H.inputSource}))}function ue(){s.removeEventListener("select",ee),s.removeEventListener("selectstart",ee),s.removeEventListener("selectend",ee),s.removeEventListener("squeeze",ee),s.removeEventListener("squeezestart",ee),s.removeEventListener("squeezeend",ee),s.removeEventListener("end",ue),s.removeEventListener("inputsourceschange",I);for(let H=0;H<M.length;H++){let ne=v[H];ne!==null&&(v[H]=null,M[H].disconnect(ne))}w=null,N=null,e.setRenderTarget(p),g=null,f=null,u=null,s=null,d=null,fe.stop(),n.isPresenting=!1,e.setPixelRatio(P),e.setSize(T.width,T.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(H){r=H,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(H){a=H,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(H){c=H},this.getBaseLayer=function(){return f!==null?f:g},this.getBinding=function(){return u},this.getFrame=function(){return _},this.getSession=function(){return s},this.setSession=async function(H){if(s=H,s!==null){if(p=e.getRenderTarget(),s.addEventListener("select",ee),s.addEventListener("selectstart",ee),s.addEventListener("selectend",ee),s.addEventListener("squeeze",ee),s.addEventListener("squeezestart",ee),s.addEventListener("squeezeend",ee),s.addEventListener("end",ue),s.addEventListener("inputsourceschange",I),m.xrCompatible!==!0&&await t.makeXRCompatible(),P=e.getPixelRatio(),e.getSize(T),s.renderState.layers===void 0||e.capabilities.isWebGL2===!1){let ne={antialias:s.renderState.layers===void 0?m.antialias:!0,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:r};g=new XRWebGLLayer(s,t,ne),s.updateRenderState({baseLayer:g}),e.setPixelRatio(1),e.setSize(g.framebufferWidth,g.framebufferHeight,!1),d=new An(g.framebufferWidth,g.framebufferHeight,{format:Xt,type:kn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil})}else{let ne=null,de=null,ge=null;m.depth&&(ge=m.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ne=m.stencil?Fi:ni,de=m.stencil?ti:Fn);let ye={colorFormat:t.RGBA8,depthFormat:ge,scaleFactor:r};u=new XRWebGLBinding(s,t),f=u.createProjectionLayer(ye),s.updateRenderState({layers:[f]}),e.setPixelRatio(1),e.setSize(f.textureWidth,f.textureHeight,!1),d=new An(f.textureWidth,f.textureHeight,{format:Xt,type:kn,depthTexture:new pr(f.textureWidth,f.textureHeight,de,void 0,void 0,void 0,void 0,void 0,void 0,ne),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0});let Le=e.properties.get(d);Le.__ignoreDepthValues=f.ignoreDepthValues}d.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),fe.setContext(s),fe.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode};function I(H){for(let ne=0;ne<H.removed.length;ne++){let de=H.removed[ne],ge=v.indexOf(de);ge>=0&&(v[ge]=null,M[ge].disconnect(de))}for(let ne=0;ne<H.added.length;ne++){let de=H.added[ne],ge=v.indexOf(de);if(ge===-1){for(let Le=0;Le<M.length;Le++)if(Le>=v.length){v.push(de),ge=Le;break}else if(v[Le]===null){v[Le]=de,ge=Le;break}if(ge===-1)break}let ye=M[ge];ye&&ye.connect(de)}}let U=new D,q=new D;function Q(H,ne,de){U.setFromMatrixPosition(ne.matrixWorld),q.setFromMatrixPosition(de.matrixWorld);let ge=U.distanceTo(q),ye=ne.projectionMatrix.elements,Le=de.projectionMatrix.elements,Ie=ye[14]/(ye[10]-1),Ee=ye[14]/(ye[10]+1),ke=(ye[9]+1)/ye[5],O=(ye[9]-1)/ye[5],Ke=(ye[8]-1)/ye[0],be=(Le[8]+1)/Le[0],Pe=Ie*Ke,Me=Ie*be,W=ge/(-Ke+be),G=W*-Ke;ne.matrixWorld.decompose(H.position,H.quaternion,H.scale),H.translateX(G),H.translateZ(W),H.matrixWorld.compose(H.position,H.quaternion,H.scale),H.matrixWorldInverse.copy(H.matrixWorld).invert();let y=Ie+W,x=Ee+W,L=Pe-G,Y=Me+(ge-G),Z=ke*Ee/x*y,B=O*Ee/x*y;H.projectionMatrix.makePerspective(L,Y,Z,B,y,x),H.projectionMatrixInverse.copy(H.projectionMatrix).invert()}function j(H,ne){ne===null?H.matrixWorld.copy(H.matrix):H.matrixWorld.multiplyMatrices(ne.matrixWorld,H.matrix),H.matrixWorldInverse.copy(H.matrixWorld).invert()}this.updateCamera=function(H){if(s===null)return;b.near=A.near=R.near=H.near,b.far=A.far=R.far=H.far,(w!==b.near||N!==b.far)&&(s.updateRenderState({depthNear:b.near,depthFar:b.far}),w=b.near,N=b.far);let ne=H.parent,de=b.cameras;j(b,ne);for(let ge=0;ge<de.length;ge++)j(de[ge],ne);de.length===2?Q(b,R,A):b.projectionMatrix.copy(R.projectionMatrix),J(H,b,ne)};function J(H,ne,de){de===null?H.matrix.copy(ne.matrixWorld):(H.matrix.copy(de.matrixWorld),H.matrix.invert(),H.matrix.multiply(ne.matrixWorld)),H.matrix.decompose(H.position,H.quaternion,H.scale),H.updateMatrixWorld(!0),H.projectionMatrix.copy(ne.projectionMatrix),H.projectionMatrixInverse.copy(ne.projectionMatrixInverse),H.isPerspectiveCamera&&(H.fov=os*2*Math.atan(1/H.projectionMatrix.elements[5]),H.zoom=1)}this.getCamera=function(){return b},this.getFoveation=function(){if(!(f===null&&g===null))return l},this.setFoveation=function(H){l=H,f!==null&&(f.fixedFoveation=H),g!==null&&g.fixedFoveation!==void 0&&(g.fixedFoveation=H)};let te=null;function re(H,ne){if(h=ne.getViewerPose(c||o),_=ne,h!==null){let de=h.views;g!==null&&(e.setRenderTargetFramebuffer(d,g.framebuffer),e.setRenderTarget(d));let ge=!1;de.length!==b.cameras.length&&(b.cameras.length=0,ge=!0);for(let ye=0;ye<de.length;ye++){let Le=de[ye],Ie=null;if(g!==null)Ie=g.getViewport(Le);else{let ke=u.getViewSubImage(f,Le);Ie=ke.viewport,ye===0&&(e.setRenderTargetTextures(d,ke.colorTexture,f.ignoreDepthValues?void 0:ke.depthStencilTexture),e.setRenderTarget(d))}let Ee=X[ye];Ee===void 0&&(Ee=new Ft,Ee.layers.enable(ye),Ee.viewport=new _t,X[ye]=Ee),Ee.matrix.fromArray(Le.transform.matrix),Ee.matrix.decompose(Ee.position,Ee.quaternion,Ee.scale),Ee.projectionMatrix.fromArray(Le.projectionMatrix),Ee.projectionMatrixInverse.copy(Ee.projectionMatrix).invert(),Ee.viewport.set(Ie.x,Ie.y,Ie.width,Ie.height),ye===0&&(b.matrix.copy(Ee.matrix),b.matrix.decompose(b.position,b.quaternion,b.scale)),ge===!0&&b.cameras.push(Ee)}}for(let de=0;de<M.length;de++){let ge=v[de],ye=M[de];ge!==null&&ye!==void 0&&ye.update(ge,ne,c||o)}te&&te(H,ne),ne.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ne}),_=null}let fe=new Tc;fe.setAnimationLoop(re),this.setAnimationLoop=function(H){te=H},this.dispose=function(){}}};function hg(i,e){function t(p,d){p.matrixAutoUpdate===!0&&p.updateMatrix(),d.value.copy(p.matrix)}function n(p,d){d.color.getRGB(p.fogColor.value,Ec(i)),d.isFog?(p.fogNear.value=d.near,p.fogFar.value=d.far):d.isFogExp2&&(p.fogDensity.value=d.density)}function s(p,d,M,v,T){d.isMeshBasicMaterial||d.isMeshLambertMaterial?r(p,d):d.isMeshToonMaterial?(r(p,d),u(p,d)):d.isMeshPhongMaterial?(r(p,d),h(p,d)):d.isMeshStandardMaterial?(r(p,d),f(p,d),d.isMeshPhysicalMaterial&&g(p,d,T)):d.isMeshMatcapMaterial?(r(p,d),_(p,d)):d.isMeshDepthMaterial?r(p,d):d.isMeshDistanceMaterial?(r(p,d),m(p,d)):d.isMeshNormalMaterial?r(p,d):d.isLineBasicMaterial?(o(p,d),d.isLineDashedMaterial&&a(p,d)):d.isPointsMaterial?l(p,d,M,v):d.isSpriteMaterial?c(p,d):d.isShadowMaterial?(p.color.value.copy(d.color),p.opacity.value=d.opacity):d.isShaderMaterial&&(d.uniformsNeedUpdate=!1)}function r(p,d){p.opacity.value=d.opacity,d.color&&p.diffuse.value.copy(d.color),d.emissive&&p.emissive.value.copy(d.emissive).multiplyScalar(d.emissiveIntensity),d.map&&(p.map.value=d.map,t(d.map,p.mapTransform)),d.alphaMap&&(p.alphaMap.value=d.alphaMap,t(d.alphaMap,p.alphaMapTransform)),d.bumpMap&&(p.bumpMap.value=d.bumpMap,t(d.bumpMap,p.bumpMapTransform),p.bumpScale.value=d.bumpScale,d.side===Rt&&(p.bumpScale.value*=-1)),d.normalMap&&(p.normalMap.value=d.normalMap,t(d.normalMap,p.normalMapTransform),p.normalScale.value.copy(d.normalScale),d.side===Rt&&p.normalScale.value.negate()),d.displacementMap&&(p.displacementMap.value=d.displacementMap,t(d.displacementMap,p.displacementMapTransform),p.displacementScale.value=d.displacementScale,p.displacementBias.value=d.displacementBias),d.emissiveMap&&(p.emissiveMap.value=d.emissiveMap,t(d.emissiveMap,p.emissiveMapTransform)),d.specularMap&&(p.specularMap.value=d.specularMap,t(d.specularMap,p.specularMapTransform)),d.alphaTest>0&&(p.alphaTest.value=d.alphaTest);let M=e.get(d).envMap;if(M&&(p.envMap.value=M,p.flipEnvMap.value=M.isCubeTexture&&M.isRenderTargetTexture===!1?-1:1,p.reflectivity.value=d.reflectivity,p.ior.value=d.ior,p.refractionRatio.value=d.refractionRatio),d.lightMap){p.lightMap.value=d.lightMap;let v=i._useLegacyLights===!0?Math.PI:1;p.lightMapIntensity.value=d.lightMapIntensity*v,t(d.lightMap,p.lightMapTransform)}d.aoMap&&(p.aoMap.value=d.aoMap,p.aoMapIntensity.value=d.aoMapIntensity,t(d.aoMap,p.aoMapTransform))}function o(p,d){p.diffuse.value.copy(d.color),p.opacity.value=d.opacity,d.map&&(p.map.value=d.map,t(d.map,p.mapTransform))}function a(p,d){p.dashSize.value=d.dashSize,p.totalSize.value=d.dashSize+d.gapSize,p.scale.value=d.scale}function l(p,d,M,v){p.diffuse.value.copy(d.color),p.opacity.value=d.opacity,p.size.value=d.size*M,p.scale.value=v*.5,d.map&&(p.map.value=d.map,t(d.map,p.uvTransform)),d.alphaMap&&(p.alphaMap.value=d.alphaMap,t(d.alphaMap,p.alphaMapTransform)),d.alphaTest>0&&(p.alphaTest.value=d.alphaTest)}function c(p,d){p.diffuse.value.copy(d.color),p.opacity.value=d.opacity,p.rotation.value=d.rotation,d.map&&(p.map.value=d.map,t(d.map,p.mapTransform)),d.alphaMap&&(p.alphaMap.value=d.alphaMap,t(d.alphaMap,p.alphaMapTransform)),d.alphaTest>0&&(p.alphaTest.value=d.alphaTest)}function h(p,d){p.specular.value.copy(d.specular),p.shininess.value=Math.max(d.shininess,1e-4)}function u(p,d){d.gradientMap&&(p.gradientMap.value=d.gradientMap)}function f(p,d){p.metalness.value=d.metalness,d.metalnessMap&&(p.metalnessMap.value=d.metalnessMap,t(d.metalnessMap,p.metalnessMapTransform)),p.roughness.value=d.roughness,d.roughnessMap&&(p.roughnessMap.value=d.roughnessMap,t(d.roughnessMap,p.roughnessMapTransform)),e.get(d).envMap&&(p.envMapIntensity.value=d.envMapIntensity)}function g(p,d,M){p.ior.value=d.ior,d.sheen>0&&(p.sheenColor.value.copy(d.sheenColor).multiplyScalar(d.sheen),p.sheenRoughness.value=d.sheenRoughness,d.sheenColorMap&&(p.sheenColorMap.value=d.sheenColorMap,t(d.sheenColorMap,p.sheenColorMapTransform)),d.sheenRoughnessMap&&(p.sheenRoughnessMap.value=d.sheenRoughnessMap,t(d.sheenRoughnessMap,p.sheenRoughnessMapTransform))),d.clearcoat>0&&(p.clearcoat.value=d.clearcoat,p.clearcoatRoughness.value=d.clearcoatRoughness,d.clearcoatMap&&(p.clearcoatMap.value=d.clearcoatMap,t(d.clearcoatMap,p.clearcoatMapTransform)),d.clearcoatRoughnessMap&&(p.clearcoatRoughnessMap.value=d.clearcoatRoughnessMap,t(d.clearcoatRoughnessMap,p.clearcoatRoughnessMapTransform)),d.clearcoatNormalMap&&(p.clearcoatNormalMap.value=d.clearcoatNormalMap,t(d.clearcoatNormalMap,p.clearcoatNormalMapTransform),p.clearcoatNormalScale.value.copy(d.clearcoatNormalScale),d.side===Rt&&p.clearcoatNormalScale.value.negate())),d.iridescence>0&&(p.iridescence.value=d.iridescence,p.iridescenceIOR.value=d.iridescenceIOR,p.iridescenceThicknessMinimum.value=d.iridescenceThicknessRange[0],p.iridescenceThicknessMaximum.value=d.iridescenceThicknessRange[1],d.iridescenceMap&&(p.iridescenceMap.value=d.iridescenceMap,t(d.iridescenceMap,p.iridescenceMapTransform)),d.iridescenceThicknessMap&&(p.iridescenceThicknessMap.value=d.iridescenceThicknessMap,t(d.iridescenceThicknessMap,p.iridescenceThicknessMapTransform))),d.transmission>0&&(p.transmission.value=d.transmission,p.transmissionSamplerMap.value=M.texture,p.transmissionSamplerSize.value.set(M.width,M.height),d.transmissionMap&&(p.transmissionMap.value=d.transmissionMap,t(d.transmissionMap,p.transmissionMapTransform)),p.thickness.value=d.thickness,d.thicknessMap&&(p.thicknessMap.value=d.thicknessMap,t(d.thicknessMap,p.thicknessMapTransform)),p.attenuationDistance.value=d.attenuationDistance,p.attenuationColor.value.copy(d.attenuationColor)),d.anisotropy>0&&(p.anisotropyVector.value.set(d.anisotropy*Math.cos(d.anisotropyRotation),d.anisotropy*Math.sin(d.anisotropyRotation)),d.anisotropyMap&&(p.anisotropyMap.value=d.anisotropyMap,t(d.anisotropyMap,p.anisotropyMapTransform))),p.specularIntensity.value=d.specularIntensity,p.specularColor.value.copy(d.specularColor),d.specularColorMap&&(p.specularColorMap.value=d.specularColorMap,t(d.specularColorMap,p.specularColorMapTransform)),d.specularIntensityMap&&(p.specularIntensityMap.value=d.specularIntensityMap,t(d.specularIntensityMap,p.specularIntensityMapTransform))}function _(p,d){d.matcap&&(p.matcap.value=d.matcap)}function m(p,d){let M=e.get(d).light;p.referencePosition.value.setFromMatrixPosition(M.matrixWorld),p.nearDistance.value=M.shadow.camera.near,p.farDistance.value=M.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function ug(i,e,t,n){let s={},r={},o=[],a=t.isWebGL2?i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS):0;function l(M,v){let T=v.program;n.uniformBlockBinding(M,T)}function c(M,v){let T=s[M.id];T===void 0&&(_(M),T=h(M),s[M.id]=T,M.addEventListener("dispose",p));let P=v.program;n.updateUBOMapping(M,P);let R=e.render.frame;r[M.id]!==R&&(f(M),r[M.id]=R)}function h(M){let v=u();M.__bindingPointIndex=v;let T=i.createBuffer(),P=M.__size,R=M.usage;return i.bindBuffer(i.UNIFORM_BUFFER,T),i.bufferData(i.UNIFORM_BUFFER,P,R),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,v,T),T}function u(){for(let M=0;M<a;M++)if(o.indexOf(M)===-1)return o.push(M),M;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(M){let v=s[M.id],T=M.uniforms,P=M.__cache;i.bindBuffer(i.UNIFORM_BUFFER,v);for(let R=0,A=T.length;R<A;R++){let X=Array.isArray(T[R])?T[R]:[T[R]];for(let b=0,w=X.length;b<w;b++){let N=X[b];if(g(N,R,b,P)===!0){let ee=N.__offset,ue=Array.isArray(N.value)?N.value:[N.value],I=0;for(let U=0;U<ue.length;U++){let q=ue[U],Q=m(q);typeof q=="number"||typeof q=="boolean"?(N.__data[0]=q,i.bufferSubData(i.UNIFORM_BUFFER,ee+I,N.__data)):q.isMatrix3?(N.__data[0]=q.elements[0],N.__data[1]=q.elements[1],N.__data[2]=q.elements[2],N.__data[3]=0,N.__data[4]=q.elements[3],N.__data[5]=q.elements[4],N.__data[6]=q.elements[5],N.__data[7]=0,N.__data[8]=q.elements[6],N.__data[9]=q.elements[7],N.__data[10]=q.elements[8],N.__data[11]=0):(q.toArray(N.__data,I),I+=Q.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,ee,N.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function g(M,v,T,P){let R=M.value,A=v+"_"+T;if(P[A]===void 0)return typeof R=="number"||typeof R=="boolean"?P[A]=R:P[A]=R.clone(),!0;{let X=P[A];if(typeof R=="number"||typeof R=="boolean"){if(X!==R)return P[A]=R,!0}else if(X.equals(R)===!1)return X.copy(R),!0}return!1}function _(M){let v=M.uniforms,T=0,P=16;for(let A=0,X=v.length;A<X;A++){let b=Array.isArray(v[A])?v[A]:[v[A]];for(let w=0,N=b.length;w<N;w++){let ee=b[w],ue=Array.isArray(ee.value)?ee.value:[ee.value];for(let I=0,U=ue.length;I<U;I++){let q=ue[I],Q=m(q),j=T%P;j!==0&&P-j<Q.boundary&&(T+=P-j),ee.__data=new Float32Array(Q.storage/Float32Array.BYTES_PER_ELEMENT),ee.__offset=T,T+=Q.storage}}}let R=T%P;return R>0&&(T+=P-R),M.__size=T,M.__cache={},this}function m(M){let v={boundary:0,storage:0};return typeof M=="number"||typeof M=="boolean"?(v.boundary=4,v.storage=4):M.isVector2?(v.boundary=8,v.storage=8):M.isVector3||M.isColor?(v.boundary=16,v.storage=12):M.isVector4?(v.boundary=16,v.storage=16):M.isMatrix3?(v.boundary=48,v.storage=48):M.isMatrix4?(v.boundary=64,v.storage=64):M.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",M),v}function p(M){let v=M.target;v.removeEventListener("dispose",p);let T=o.indexOf(v.__bindingPointIndex);o.splice(T,1),i.deleteBuffer(s[v.id]),delete s[v.id],delete r[v.id]}function d(){for(let M in s)i.deleteBuffer(s[M]);o=[],s={},r={}}return{bind:l,update:c,dispose:d}}var cs=class{constructor(e={}){let{canvas:t=yu(),context:n=null,depth:s=!0,stencil:r=!0,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1}=e;this.isWebGLRenderer=!0;let f;n!==null?f=n.getContextAttributes().alpha:f=o;let g=new Uint32Array(4),_=new Int32Array(4),m=null,p=null,d=[],M=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Mt,this._useLegacyLights=!1,this.toneMapping=zn,this.toneMappingExposure=1;let v=this,T=!1,P=0,R=0,A=null,X=-1,b=null,w=new _t,N=new _t,ee=null,ue=new Te(0),I=0,U=t.width,q=t.height,Q=1,j=null,J=null,te=new _t(0,0,U,q),re=new _t(0,0,U,q),fe=!1,H=new ls,ne=!1,de=!1,ge=null,ye=new rt,Le=new De,Ie=new D,Ee={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};function ke(){return A===null?Q:1}let O=n;function Ke(S,F){for(let k=0;k<S.length;k++){let V=S[k],z=t.getContext(V,F);if(z!==null)return z}return null}try{let S={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${to}`),t.addEventListener("webglcontextlost",oe,!1),t.addEventListener("webglcontextrestored",C,!1),t.addEventListener("webglcontextcreationerror",ae,!1),O===null){let F=["webgl2","webgl","experimental-webgl"];if(v.isWebGL1Renderer===!0&&F.shift(),O=Ke(F,S),O===null)throw Ke(F)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}typeof WebGLRenderingContext<"u"&&O instanceof WebGLRenderingContext&&console.warn("THREE.WebGLRenderer: WebGL 1 support was deprecated in r153 and will be removed in r163."),O.getShaderPrecisionFormat===void 0&&(O.getShaderPrecisionFormat=function(){return{rangeMin:1,rangeMax:1,precision:1}})}catch(S){throw console.error("THREE.WebGLRenderer: "+S.message),S}let be,Pe,Me,W,G,y,x,L,Y,Z,B,pe,ce,he,_e,Re,$,xe,E,K,ie,se,Se,He;function qe(){be=new Pp(O),Pe=new wp(O,be,e),be.init(Pe),se=new lg(O,be,Pe),Me=new ag(O,be,Pe),W=new Dp(O),G=new Zm,y=new og(O,be,Me,G,Pe,se,W),x=new Tp(v),L=new Cp(v),Y=new ku(O,Pe),Se=new bp(O,be,Y,Pe),Z=new Lp(O,Y,W,Se),B=new Op(O,Z,Y,W),E=new Fp(O,Pe,y),Re=new Ep(G),pe=new Ym(v,x,L,be,Pe,Se,Re),ce=new hg(v,G),he=new $m,_e=new ng(be,Pe),xe=new Mp(v,x,L,Me,B,f,l),$=new rg(v,B,Pe),He=new ug(O,W,Pe,Me),K=new Sp(O,be,W,Pe),ie=new Ip(O,be,W,Pe),W.programs=pe.programs,v.capabilities=Pe,v.extensions=be,v.properties=G,v.renderLists=he,v.shadowMap=$,v.state=Me,v.info=W}qe();let Oe=new za(v,O);this.xr=Oe,this.getContext=function(){return O},this.getContextAttributes=function(){return O.getContextAttributes()},this.forceContextLoss=function(){let S=be.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){let S=be.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return Q},this.setPixelRatio=function(S){S!==void 0&&(Q=S,this.setSize(U,q,!1))},this.getSize=function(S){return S.set(U,q)},this.setSize=function(S,F,k=!0){if(Oe.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}U=S,q=F,t.width=Math.floor(S*Q),t.height=Math.floor(F*Q),k===!0&&(t.style.width=S+"px",t.style.height=F+"px"),this.setViewport(0,0,S,F)},this.getDrawingBufferSize=function(S){return S.set(U*Q,q*Q).floor()},this.setDrawingBufferSize=function(S,F,k){U=S,q=F,Q=k,t.width=Math.floor(S*k),t.height=Math.floor(F*k),this.setViewport(0,0,S,F)},this.getCurrentViewport=function(S){return S.copy(w)},this.getViewport=function(S){return S.copy(te)},this.setViewport=function(S,F,k,V){S.isVector4?te.set(S.x,S.y,S.z,S.w):te.set(S,F,k,V),Me.viewport(w.copy(te).multiplyScalar(Q).floor())},this.getScissor=function(S){return S.copy(re)},this.setScissor=function(S,F,k,V){S.isVector4?re.set(S.x,S.y,S.z,S.w):re.set(S,F,k,V),Me.scissor(N.copy(re).multiplyScalar(Q).floor())},this.getScissorTest=function(){return fe},this.setScissorTest=function(S){Me.setScissorTest(fe=S)},this.setOpaqueSort=function(S){j=S},this.setTransparentSort=function(S){J=S},this.getClearColor=function(S){return S.copy(xe.getClearColor())},this.setClearColor=function(){xe.setClearColor.apply(xe,arguments)},this.getClearAlpha=function(){return xe.getClearAlpha()},this.setClearAlpha=function(){xe.setClearAlpha.apply(xe,arguments)},this.clear=function(S=!0,F=!0,k=!0){let V=0;if(S){let z=!1;if(A!==null){let ve=A.texture.format;z=ve===xc||ve===_c||ve===gc}if(z){let ve=A.texture.type,Ae=ve===kn||ve===Fn||ve===so||ve===ti||ve===pc||ve===mc,Ue=xe.getClearColor(),Ne=xe.getClearAlpha(),Ge=Ue.r,Be=Ue.g,ze=Ue.b;Ae?(g[0]=Ge,g[1]=Be,g[2]=ze,g[3]=Ne,O.clearBufferuiv(O.COLOR,0,g)):(_[0]=Ge,_[1]=Be,_[2]=ze,_[3]=Ne,O.clearBufferiv(O.COLOR,0,_))}else V|=O.COLOR_BUFFER_BIT}F&&(V|=O.DEPTH_BUFFER_BIT),k&&(V|=O.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),O.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",oe,!1),t.removeEventListener("webglcontextrestored",C,!1),t.removeEventListener("webglcontextcreationerror",ae,!1),he.dispose(),_e.dispose(),G.dispose(),x.dispose(),L.dispose(),B.dispose(),Se.dispose(),He.dispose(),pe.dispose(),Oe.dispose(),Oe.removeEventListener("sessionstart",Lt),Oe.removeEventListener("sessionend",je),ge&&(ge.dispose(),ge=null),It.stop()};function oe(S){S.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),T=!0}function C(){console.log("THREE.WebGLRenderer: Context Restored."),T=!1;let S=W.autoReset,F=$.enabled,k=$.autoUpdate,V=$.needsUpdate,z=$.type;qe(),W.autoReset=S,$.enabled=F,$.autoUpdate=k,$.needsUpdate=V,$.type=z}function ae(S){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function le(S){let F=S.target;F.removeEventListener("dispose",le),Ce(F)}function Ce(S){we(S),G.remove(S)}function we(S){let F=G.get(S).programs;F!==void 0&&(F.forEach(function(k){pe.releaseProgram(k)}),S.isShaderMaterial&&pe.releaseShaderCache(S))}this.renderBufferDirect=function(S,F,k,V,z,ve){F===null&&(F=Ee);let Ae=z.isMesh&&z.matrixWorld.determinant()<0,Ue=rh(S,F,k,V,z);Me.setMaterial(V,Ae);let Ne=k.index,Ge=1;if(V.wireframe===!0){if(Ne=Z.getWireframeAttribute(k),Ne===void 0)return;Ge=2}let Be=k.drawRange,ze=k.attributes.position,at=Be.start*Ge,Vt=(Be.start+Be.count)*Ge;ve!==null&&(at=Math.max(at,ve.start*Ge),Vt=Math.min(Vt,(ve.start+ve.count)*Ge)),Ne!==null?(at=Math.max(at,0),Vt=Math.min(Vt,Ne.count)):ze!=null&&(at=Math.max(at,0),Vt=Math.min(Vt,ze.count));let mt=Vt-at;if(mt<0||mt===1/0)return;Se.setup(z,V,Ue,k,Ne);let _n,it=K;if(Ne!==null&&(_n=Y.get(Ne),it=ie,it.setIndex(_n)),z.isMesh)V.wireframe===!0?(Me.setLineWidth(V.wireframeLinewidth*ke()),it.setMode(O.LINES)):it.setMode(O.TRIANGLES);else if(z.isLine){let We=V.linewidth;We===void 0&&(We=1),Me.setLineWidth(We*ke()),z.isLineSegments?it.setMode(O.LINES):z.isLineLoop?it.setMode(O.LINE_LOOP):it.setMode(O.LINE_STRIP)}else z.isPoints?it.setMode(O.POINTS):z.isSprite&&it.setMode(O.TRIANGLES);if(z.isBatchedMesh)it.renderMultiDraw(z._multiDrawStarts,z._multiDrawCounts,z._multiDrawCount);else if(z.isInstancedMesh)it.renderInstances(at,mt,z.count);else if(k.isInstancedBufferGeometry){let We=k._maxInstanceCount!==void 0?k._maxInstanceCount:1/0,Or=Math.min(k.instanceCount,We);it.renderInstances(at,mt,Or)}else it.render(at,mt)};function Ye(S,F,k){S.transparent===!0&&S.side===wn&&S.forceSinglePass===!1?(S.side=Rt,S.needsUpdate=!0,Ms(S,F,k),S.side=Hn,S.needsUpdate=!0,Ms(S,F,k),S.side=wn):Ms(S,F,k)}this.compile=function(S,F,k=null){k===null&&(k=S),p=_e.get(k),p.init(),M.push(p),k.traverseVisible(function(z){z.isLight&&z.layers.test(F.layers)&&(p.pushLight(z),z.castShadow&&p.pushShadow(z))}),S!==k&&S.traverseVisible(function(z){z.isLight&&z.layers.test(F.layers)&&(p.pushLight(z),z.castShadow&&p.pushShadow(z))}),p.setupLights(v._useLegacyLights);let V=new Set;return S.traverse(function(z){let ve=z.material;if(ve)if(Array.isArray(ve))for(let Ae=0;Ae<ve.length;Ae++){let Ue=ve[Ae];Ye(Ue,k,z),V.add(Ue)}else Ye(ve,k,z),V.add(ve)}),M.pop(),p=null,V},this.compileAsync=function(S,F,k=null){let V=this.compile(S,F,k);return new Promise(z=>{function ve(){if(V.forEach(function(Ae){G.get(Ae).currentProgram.isReady()&&V.delete(Ae)}),V.size===0){z(S);return}setTimeout(ve,10)}be.get("KHR_parallel_shader_compile")!==null?ve():setTimeout(ve,10)})};let Ze=null;function pt(S){Ze&&Ze(S)}function Lt(){It.stop()}function je(){It.start()}let It=new Tc;It.setAnimationLoop(pt),typeof self<"u"&&It.setContext(self),this.setAnimationLoop=function(S){Ze=S,Oe.setAnimationLoop(S),S===null?It.stop():It.start()},Oe.addEventListener("sessionstart",Lt),Oe.addEventListener("sessionend",je),this.render=function(S,F){if(F!==void 0&&F.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(T===!0)return;S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),F.parent===null&&F.matrixWorldAutoUpdate===!0&&F.updateMatrixWorld(),Oe.enabled===!0&&Oe.isPresenting===!0&&(Oe.cameraAutoUpdate===!0&&Oe.updateCamera(F),F=Oe.getCamera()),S.isScene===!0&&S.onBeforeRender(v,S,F,A),p=_e.get(S,M.length),p.init(),M.push(p),ye.multiplyMatrices(F.projectionMatrix,F.matrixWorldInverse),H.setFromProjectionMatrix(ye),de=this.localClippingEnabled,ne=Re.init(this.clippingPlanes,de),m=he.get(S,d.length),m.init(),d.push(m),un(S,F,0,v.sortObjects),m.finish(),v.sortObjects===!0&&m.sort(j,J),this.info.render.frame++,ne===!0&&Re.beginShadows();let k=p.state.shadowsArray;if($.render(k,S,F),ne===!0&&Re.endShadows(),this.info.autoReset===!0&&this.info.reset(),xe.render(m,S),p.setupLights(v._useLegacyLights),F.isArrayCamera){let V=F.cameras;for(let z=0,ve=V.length;z<ve;z++){let Ae=V[z];To(m,S,Ae,Ae.viewport)}}else To(m,S,F);A!==null&&(y.updateMultisampleRenderTarget(A),y.updateRenderTargetMipmap(A)),S.isScene===!0&&S.onAfterRender(v,S,F),Se.resetDefaultState(),X=-1,b=null,M.pop(),M.length>0?p=M[M.length-1]:p=null,d.pop(),d.length>0?m=d[d.length-1]:m=null};function un(S,F,k,V){if(S.visible===!1)return;if(S.layers.test(F.layers)){if(S.isGroup)k=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(F);else if(S.isLight)p.pushLight(S),S.castShadow&&p.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||H.intersectsSprite(S)){V&&Ie.setFromMatrixPosition(S.matrixWorld).applyMatrix4(ye);let Ae=B.update(S),Ue=S.material;Ue.visible&&m.push(S,Ae,Ue,k,Ie.z,null)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||H.intersectsObject(S))){let Ae=B.update(S),Ue=S.material;if(V&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),Ie.copy(S.boundingSphere.center)):(Ae.boundingSphere===null&&Ae.computeBoundingSphere(),Ie.copy(Ae.boundingSphere.center)),Ie.applyMatrix4(S.matrixWorld).applyMatrix4(ye)),Array.isArray(Ue)){let Ne=Ae.groups;for(let Ge=0,Be=Ne.length;Ge<Be;Ge++){let ze=Ne[Ge],at=Ue[ze.materialIndex];at&&at.visible&&m.push(S,Ae,at,k,Ie.z,ze)}}else Ue.visible&&m.push(S,Ae,Ue,k,Ie.z,null)}}let ve=S.children;for(let Ae=0,Ue=ve.length;Ae<Ue;Ae++)un(ve[Ae],F,k,V)}function To(S,F,k,V){let z=S.opaque,ve=S.transmissive,Ae=S.transparent;p.setupLightsView(k),ne===!0&&Re.setGlobalState(v.clippingPlanes,k),ve.length>0&&sh(z,ve,F,k),V&&Me.viewport(w.copy(V)),z.length>0&&ys(z,F,k),ve.length>0&&ys(ve,F,k),Ae.length>0&&ys(Ae,F,k),Me.buffers.depth.setTest(!0),Me.buffers.depth.setMask(!0),Me.buffers.color.setMask(!0),Me.setPolygonOffset(!1)}function sh(S,F,k,V){if((k.isScene===!0?k.overrideMaterial:null)!==null)return;let ve=Pe.isWebGL2;ge===null&&(ge=new An(1,1,{generateMipmaps:!0,type:be.has("EXT_color_buffer_half_float")?as:kn,minFilter:rs,samples:ve?4:0})),v.getDrawingBufferSize(Le),ve?ge.setSize(Le.x,Le.y):ge.setSize(er(Le.x),er(Le.y));let Ae=v.getRenderTarget();v.setRenderTarget(ge),v.getClearColor(ue),I=v.getClearAlpha(),I<1&&v.setClearColor(16777215,.5),v.clear();let Ue=v.toneMapping;v.toneMapping=zn,ys(S,k,V),y.updateMultisampleRenderTarget(ge),y.updateRenderTargetMipmap(ge);let Ne=!1;for(let Ge=0,Be=F.length;Ge<Be;Ge++){let ze=F[Ge],at=ze.object,Vt=ze.geometry,mt=ze.material,_n=ze.group;if(mt.side===wn&&at.layers.test(V.layers)){let it=mt.side;mt.side=Rt,mt.needsUpdate=!0,Ao(at,k,V,Vt,mt,_n),mt.side=it,mt.needsUpdate=!0,Ne=!0}}Ne===!0&&(y.updateMultisampleRenderTarget(ge),y.updateRenderTargetMipmap(ge)),v.setRenderTarget(Ae),v.setClearColor(ue,I),v.toneMapping=Ue}function ys(S,F,k){let V=F.isScene===!0?F.overrideMaterial:null;for(let z=0,ve=S.length;z<ve;z++){let Ae=S[z],Ue=Ae.object,Ne=Ae.geometry,Ge=V===null?Ae.material:V,Be=Ae.group;Ue.layers.test(k.layers)&&Ao(Ue,F,k,Ne,Ge,Be)}}function Ao(S,F,k,V,z,ve){S.onBeforeRender(v,F,k,V,z,ve),S.modelViewMatrix.multiplyMatrices(k.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),z.onBeforeRender(v,F,k,V,S,ve),z.transparent===!0&&z.side===wn&&z.forceSinglePass===!1?(z.side=Rt,z.needsUpdate=!0,v.renderBufferDirect(k,F,V,z,S,ve),z.side=Hn,z.needsUpdate=!0,v.renderBufferDirect(k,F,V,z,S,ve),z.side=wn):v.renderBufferDirect(k,F,V,z,S,ve),S.onAfterRender(v,F,k,V,z,ve)}function Ms(S,F,k){F.isScene!==!0&&(F=Ee);let V=G.get(S),z=p.state.lights,ve=p.state.shadowsArray,Ae=z.state.version,Ue=pe.getParameters(S,z.state,ve,F,k),Ne=pe.getProgramCacheKey(Ue),Ge=V.programs;V.environment=S.isMeshStandardMaterial?F.environment:null,V.fog=F.fog,V.envMap=(S.isMeshStandardMaterial?L:x).get(S.envMap||V.environment),Ge===void 0&&(S.addEventListener("dispose",le),Ge=new Map,V.programs=Ge);let Be=Ge.get(Ne);if(Be!==void 0){if(V.currentProgram===Be&&V.lightsStateVersion===Ae)return Co(S,Ue),Be}else Ue.uniforms=pe.getUniforms(S),S.onBuild(k,Ue,v),S.onBeforeCompile(Ue,v),Be=pe.acquireProgram(Ue,Ne),Ge.set(Ne,Be),V.uniforms=Ue.uniforms;let ze=V.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(ze.clippingPlanes=Re.uniform),Co(S,Ue),V.needsLights=oh(S),V.lightsStateVersion=Ae,V.needsLights&&(ze.ambientLightColor.value=z.state.ambient,ze.lightProbe.value=z.state.probe,ze.directionalLights.value=z.state.directional,ze.directionalLightShadows.value=z.state.directionalShadow,ze.spotLights.value=z.state.spot,ze.spotLightShadows.value=z.state.spotShadow,ze.rectAreaLights.value=z.state.rectArea,ze.ltc_1.value=z.state.rectAreaLTC1,ze.ltc_2.value=z.state.rectAreaLTC2,ze.pointLights.value=z.state.point,ze.pointLightShadows.value=z.state.pointShadow,ze.hemisphereLights.value=z.state.hemi,ze.directionalShadowMap.value=z.state.directionalShadowMap,ze.directionalShadowMatrix.value=z.state.directionalShadowMatrix,ze.spotShadowMap.value=z.state.spotShadowMap,ze.spotLightMatrix.value=z.state.spotLightMatrix,ze.spotLightMap.value=z.state.spotLightMap,ze.pointShadowMap.value=z.state.pointShadowMap,ze.pointShadowMatrix.value=z.state.pointShadowMatrix),V.currentProgram=Be,V.uniformsList=null,Be}function Ro(S){if(S.uniformsList===null){let F=S.currentProgram.getUniforms();S.uniformsList=Di.seqWithValue(F.seq,S.uniforms)}return S.uniformsList}function Co(S,F){let k=G.get(S);k.outputColorSpace=F.outputColorSpace,k.batching=F.batching,k.instancing=F.instancing,k.instancingColor=F.instancingColor,k.skinning=F.skinning,k.morphTargets=F.morphTargets,k.morphNormals=F.morphNormals,k.morphColors=F.morphColors,k.morphTargetsCount=F.morphTargetsCount,k.numClippingPlanes=F.numClippingPlanes,k.numIntersection=F.numClipIntersection,k.vertexAlphas=F.vertexAlphas,k.vertexTangents=F.vertexTangents,k.toneMapping=F.toneMapping}function rh(S,F,k,V,z){F.isScene!==!0&&(F=Ee),y.resetTextureUnits();let ve=F.fog,Ae=V.isMeshStandardMaterial?F.environment:null,Ue=A===null?v.outputColorSpace:A.isXRRenderTarget===!0?A.texture.colorSpace:Tn,Ne=(V.isMeshStandardMaterial?L:x).get(V.envMap||Ae),Ge=V.vertexColors===!0&&!!k.attributes.color&&k.attributes.color.itemSize===4,Be=!!k.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),ze=!!k.morphAttributes.position,at=!!k.morphAttributes.normal,Vt=!!k.morphAttributes.color,mt=zn;V.toneMapped&&(A===null||A.isXRRenderTarget===!0)&&(mt=v.toneMapping);let _n=k.morphAttributes.position||k.morphAttributes.normal||k.morphAttributes.color,it=_n!==void 0?_n.length:0,We=G.get(V),Or=p.state.lights;if(ne===!0&&(de===!0||S!==b)){let Jt=S===b&&V.id===X;Re.setState(V,S,Jt)}let st=!1;V.version===We.__version?(We.needsLights&&We.lightsStateVersion!==Or.state.version||We.outputColorSpace!==Ue||z.isBatchedMesh&&We.batching===!1||!z.isBatchedMesh&&We.batching===!0||z.isInstancedMesh&&We.instancing===!1||!z.isInstancedMesh&&We.instancing===!0||z.isSkinnedMesh&&We.skinning===!1||!z.isSkinnedMesh&&We.skinning===!0||z.isInstancedMesh&&We.instancingColor===!0&&z.instanceColor===null||z.isInstancedMesh&&We.instancingColor===!1&&z.instanceColor!==null||We.envMap!==Ne||V.fog===!0&&We.fog!==ve||We.numClippingPlanes!==void 0&&(We.numClippingPlanes!==Re.numPlanes||We.numIntersection!==Re.numIntersection)||We.vertexAlphas!==Ge||We.vertexTangents!==Be||We.morphTargets!==ze||We.morphNormals!==at||We.morphColors!==Vt||We.toneMapping!==mt||Pe.isWebGL2===!0&&We.morphTargetsCount!==it)&&(st=!0):(st=!0,We.__version=V.version);let qn=We.currentProgram;st===!0&&(qn=Ms(V,F,z));let Po=!1,Zi=!1,Br=!1,wt=qn.getUniforms(),Yn=We.uniforms;if(Me.useProgram(qn.program)&&(Po=!0,Zi=!0,Br=!0),V.id!==X&&(X=V.id,Zi=!0),Po||b!==S){wt.setValue(O,"projectionMatrix",S.projectionMatrix),wt.setValue(O,"viewMatrix",S.matrixWorldInverse);let Jt=wt.map.cameraPosition;Jt!==void 0&&Jt.setValue(O,Ie.setFromMatrixPosition(S.matrixWorld)),Pe.logarithmicDepthBuffer&&wt.setValue(O,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&wt.setValue(O,"isOrthographic",S.isOrthographicCamera===!0),b!==S&&(b=S,Zi=!0,Br=!0)}if(z.isSkinnedMesh){wt.setOptional(O,z,"bindMatrix"),wt.setOptional(O,z,"bindMatrixInverse");let Jt=z.skeleton;Jt&&(Pe.floatVertexTextures?(Jt.boneTexture===null&&Jt.computeBoneTexture(),wt.setValue(O,"boneTexture",Jt.boneTexture,y)):console.warn("THREE.WebGLRenderer: SkinnedMesh can only be used with WebGL 2. With WebGL 1 OES_texture_float and vertex textures support is required."))}z.isBatchedMesh&&(wt.setOptional(O,z,"batchingTexture"),wt.setValue(O,"batchingTexture",z._matricesTexture,y));let zr=k.morphAttributes;if((zr.position!==void 0||zr.normal!==void 0||zr.color!==void 0&&Pe.isWebGL2===!0)&&E.update(z,k,qn),(Zi||We.receiveShadow!==z.receiveShadow)&&(We.receiveShadow=z.receiveShadow,wt.setValue(O,"receiveShadow",z.receiveShadow)),V.isMeshGouraudMaterial&&V.envMap!==null&&(Yn.envMap.value=Ne,Yn.flipEnvMap.value=Ne.isCubeTexture&&Ne.isRenderTargetTexture===!1?-1:1),Zi&&(wt.setValue(O,"toneMappingExposure",v.toneMappingExposure),We.needsLights&&ah(Yn,Br),ve&&V.fog===!0&&ce.refreshFogUniforms(Yn,ve),ce.refreshMaterialUniforms(Yn,V,Q,q,ge),Di.upload(O,Ro(We),Yn,y)),V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(Di.upload(O,Ro(We),Yn,y),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&wt.setValue(O,"center",z.center),wt.setValue(O,"modelViewMatrix",z.modelViewMatrix),wt.setValue(O,"normalMatrix",z.normalMatrix),wt.setValue(O,"modelMatrix",z.matrixWorld),V.isShaderMaterial||V.isRawShaderMaterial){let Jt=V.uniformsGroups;for(let kr=0,lh=Jt.length;kr<lh;kr++)if(Pe.isWebGL2){let Lo=Jt[kr];He.update(Lo,qn),He.bind(Lo,qn)}else console.warn("THREE.WebGLRenderer: Uniform Buffer Objects can only be used with WebGL 2.")}return qn}function ah(S,F){S.ambientLightColor.needsUpdate=F,S.lightProbe.needsUpdate=F,S.directionalLights.needsUpdate=F,S.directionalLightShadows.needsUpdate=F,S.pointLights.needsUpdate=F,S.pointLightShadows.needsUpdate=F,S.spotLights.needsUpdate=F,S.spotLightShadows.needsUpdate=F,S.rectAreaLights.needsUpdate=F,S.hemisphereLights.needsUpdate=F}function oh(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return P},this.getActiveMipmapLevel=function(){return R},this.getRenderTarget=function(){return A},this.setRenderTargetTextures=function(S,F,k){G.get(S.texture).__webglTexture=F,G.get(S.depthTexture).__webglTexture=k;let V=G.get(S);V.__hasExternalTextures=!0,V.__hasExternalTextures&&(V.__autoAllocateDepthBuffer=k===void 0,V.__autoAllocateDepthBuffer||be.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),V.__useRenderToTexture=!1))},this.setRenderTargetFramebuffer=function(S,F){let k=G.get(S);k.__webglFramebuffer=F,k.__useDefaultFramebuffer=F===void 0},this.setRenderTarget=function(S,F=0,k=0){A=S,P=F,R=k;let V=!0,z=null,ve=!1,Ae=!1;if(S){let Ne=G.get(S);Ne.__useDefaultFramebuffer!==void 0?(Me.bindFramebuffer(O.FRAMEBUFFER,null),V=!1):Ne.__webglFramebuffer===void 0?y.setupRenderTarget(S):Ne.__hasExternalTextures&&y.rebindTextures(S,G.get(S.texture).__webglTexture,G.get(S.depthTexture).__webglTexture);let Ge=S.texture;(Ge.isData3DTexture||Ge.isDataArrayTexture||Ge.isCompressedArrayTexture)&&(Ae=!0);let Be=G.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(Be[F])?z=Be[F][k]:z=Be[F],ve=!0):Pe.isWebGL2&&S.samples>0&&y.useMultisampledRTT(S)===!1?z=G.get(S).__webglMultisampledFramebuffer:Array.isArray(Be)?z=Be[k]:z=Be,w.copy(S.viewport),N.copy(S.scissor),ee=S.scissorTest}else w.copy(te).multiplyScalar(Q).floor(),N.copy(re).multiplyScalar(Q).floor(),ee=fe;if(Me.bindFramebuffer(O.FRAMEBUFFER,z)&&Pe.drawBuffers&&V&&Me.drawBuffers(S,z),Me.viewport(w),Me.scissor(N),Me.setScissorTest(ee),ve){let Ne=G.get(S.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_CUBE_MAP_POSITIVE_X+F,Ne.__webglTexture,k)}else if(Ae){let Ne=G.get(S.texture),Ge=F||0;O.framebufferTextureLayer(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,Ne.__webglTexture,k||0,Ge)}X=-1},this.readRenderTargetPixels=function(S,F,k,V,z,ve,Ae){if(!(S&&S.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Ue=G.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&Ae!==void 0&&(Ue=Ue[Ae]),Ue){Me.bindFramebuffer(O.FRAMEBUFFER,Ue);try{let Ne=S.texture,Ge=Ne.format,Be=Ne.type;if(Ge!==Xt&&se.convert(Ge)!==O.getParameter(O.IMPLEMENTATION_COLOR_READ_FORMAT)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}let ze=Be===as&&(be.has("EXT_color_buffer_half_float")||Pe.isWebGL2&&be.has("EXT_color_buffer_float"));if(Be!==kn&&se.convert(Be)!==O.getParameter(O.IMPLEMENTATION_COLOR_READ_TYPE)&&!(Be===On&&(Pe.isWebGL2||be.has("OES_texture_float")||be.has("WEBGL_color_buffer_float")))&&!ze){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}F>=0&&F<=S.width-V&&k>=0&&k<=S.height-z&&O.readPixels(F,k,V,z,se.convert(Ge),se.convert(Be),ve)}finally{let Ne=A!==null?G.get(A).__webglFramebuffer:null;Me.bindFramebuffer(O.FRAMEBUFFER,Ne)}}},this.copyFramebufferToTexture=function(S,F,k=0){let V=Math.pow(2,-k),z=Math.floor(F.image.width*V),ve=Math.floor(F.image.height*V);y.setTexture2D(F,0),O.copyTexSubImage2D(O.TEXTURE_2D,k,0,0,S.x,S.y,z,ve),Me.unbindTexture()},this.copyTextureToTexture=function(S,F,k,V=0){let z=F.image.width,ve=F.image.height,Ae=se.convert(k.format),Ue=se.convert(k.type);y.setTexture2D(k,0),O.pixelStorei(O.UNPACK_FLIP_Y_WEBGL,k.flipY),O.pixelStorei(O.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),O.pixelStorei(O.UNPACK_ALIGNMENT,k.unpackAlignment),F.isDataTexture?O.texSubImage2D(O.TEXTURE_2D,V,S.x,S.y,z,ve,Ae,Ue,F.image.data):F.isCompressedTexture?O.compressedTexSubImage2D(O.TEXTURE_2D,V,S.x,S.y,F.mipmaps[0].width,F.mipmaps[0].height,Ae,F.mipmaps[0].data):O.texSubImage2D(O.TEXTURE_2D,V,S.x,S.y,Ae,Ue,F.image),V===0&&k.generateMipmaps&&O.generateMipmap(O.TEXTURE_2D),Me.unbindTexture()},this.copyTextureToTexture3D=function(S,F,k,V,z=0){if(v.isWebGL1Renderer){console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: can only be used with WebGL2.");return}let ve=S.max.x-S.min.x+1,Ae=S.max.y-S.min.y+1,Ue=S.max.z-S.min.z+1,Ne=se.convert(V.format),Ge=se.convert(V.type),Be;if(V.isData3DTexture)y.setTexture3D(V,0),Be=O.TEXTURE_3D;else if(V.isDataArrayTexture||V.isCompressedArrayTexture)y.setTexture2DArray(V,0),Be=O.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}O.pixelStorei(O.UNPACK_FLIP_Y_WEBGL,V.flipY),O.pixelStorei(O.UNPACK_PREMULTIPLY_ALPHA_WEBGL,V.premultiplyAlpha),O.pixelStorei(O.UNPACK_ALIGNMENT,V.unpackAlignment);let ze=O.getParameter(O.UNPACK_ROW_LENGTH),at=O.getParameter(O.UNPACK_IMAGE_HEIGHT),Vt=O.getParameter(O.UNPACK_SKIP_PIXELS),mt=O.getParameter(O.UNPACK_SKIP_ROWS),_n=O.getParameter(O.UNPACK_SKIP_IMAGES),it=k.isCompressedTexture?k.mipmaps[z]:k.image;O.pixelStorei(O.UNPACK_ROW_LENGTH,it.width),O.pixelStorei(O.UNPACK_IMAGE_HEIGHT,it.height),O.pixelStorei(O.UNPACK_SKIP_PIXELS,S.min.x),O.pixelStorei(O.UNPACK_SKIP_ROWS,S.min.y),O.pixelStorei(O.UNPACK_SKIP_IMAGES,S.min.z),k.isDataTexture||k.isData3DTexture?O.texSubImage3D(Be,z,F.x,F.y,F.z,ve,Ae,Ue,Ne,Ge,it.data):k.isCompressedArrayTexture?(console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: untested support for compressed srcTexture."),O.compressedTexSubImage3D(Be,z,F.x,F.y,F.z,ve,Ae,Ue,Ne,it.data)):O.texSubImage3D(Be,z,F.x,F.y,F.z,ve,Ae,Ue,Ne,Ge,it),O.pixelStorei(O.UNPACK_ROW_LENGTH,ze),O.pixelStorei(O.UNPACK_IMAGE_HEIGHT,at),O.pixelStorei(O.UNPACK_SKIP_PIXELS,Vt),O.pixelStorei(O.UNPACK_SKIP_ROWS,mt),O.pixelStorei(O.UNPACK_SKIP_IMAGES,_n),z===0&&V.generateMipmaps&&O.generateMipmap(Be),Me.unbindTexture()},this.initTexture=function(S){S.isCubeTexture?y.setTextureCube(S,0):S.isData3DTexture?y.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?y.setTexture2DArray(S,0):y.setTexture2D(S,0),Me.unbindTexture()},this.resetState=function(){P=0,R=0,A=null,Me.reset(),Se.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return En}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=e===ro?"display-p3":"srgb",t.unpackColorSpace=$e.workingColorSpace===Ar?"display-p3":"srgb"}get outputEncoding(){return console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace===Mt?ii:yc}set outputEncoding(e){console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace=e===ii?Mt:Tn}get useLegacyLights(){return console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights}set useLegacyLights(e){console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights=e}},ka=class extends cs{};ka.prototype.isWebGL1Renderer=!0;var mr=class i{constructor(e,t=1,n=1e3){this.isFog=!0,this.name="",this.color=new Te(e),this.near=t,this.far=n}clone(){return new i(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},gr=class extends ht{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t}};var hs=class extends Qt{constructor(e=null,t=1,n=1,s,r,o,a,l,c=yt,h=yt,u,f){super(null,o,a,l,c,h,s,r,u,f),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var _r=class extends xt{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},Ti=new rt,ec=new rt,Ws=[],tc=new Rn,dg=new rt,Qi=new ot,es=new Vn,us=class extends ot{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new _r(new Float32Array(n*16),16),this.instanceColor=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,dg)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Rn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ti),tc.copy(e.boundingBox).applyMatrix4(Ti),this.boundingBox.union(tc)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new Vn),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ti),es.copy(e.boundingSphere).applyMatrix4(Ti),this.boundingSphere.union(es)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}raycast(e,t){let n=this.matrixWorld,s=this.count;if(Qi.geometry=this.geometry,Qi.material=this.material,Qi.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),es.copy(this.boundingSphere),es.applyMatrix4(n),e.ray.intersectsSphere(es)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,Ti),ec.multiplyMatrices(n,Ti),Qi.matrixWorld=ec,Qi.raycast(e,Ws);for(let o=0,a=Ws.length;o<a;o++){let l=Ws[o];l.instanceId=r,l.object=this,t.push(l)}Ws.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new _r(new Float32Array(this.instanceMatrix.count*3),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"})}};var ds=class extends Gn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Te(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},nc=new D,ic=new D,sc=new rt,ga=new Oi,Xs=new Vn,Ha=class extends ht{constructor(e=new Ot,t=new ds){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)nc.fromBufferAttribute(t,s-1),ic.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=nc.distanceTo(ic);e.setAttribute("lineDistance",new ct(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Xs.copy(n.boundingSphere),Xs.applyMatrix4(s),Xs.radius+=r,e.ray.intersectsSphere(Xs)===!1)return;sc.copy(s).invert(),ga.copy(e.ray).applyMatrix4(sc);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=new D,h=new D,u=new D,f=new D,g=this.isLineSegments?2:1,_=n.index,p=n.attributes.position;if(_!==null){let d=Math.max(0,o.start),M=Math.min(_.count,o.start+o.count);for(let v=d,T=M-1;v<T;v+=g){let P=_.getX(v),R=_.getX(v+1);if(c.fromBufferAttribute(p,P),h.fromBufferAttribute(p,R),ga.distanceSqToSegment(c,h,f,u)>l)continue;f.applyMatrix4(this.matrixWorld);let X=e.ray.origin.distanceTo(f);X<e.near||X>e.far||t.push({distance:X,point:u.clone().applyMatrix4(this.matrixWorld),index:v,face:null,faceIndex:null,object:this})}}else{let d=Math.max(0,o.start),M=Math.min(p.count,o.start+o.count);for(let v=d,T=M-1;v<T;v+=g){if(c.fromBufferAttribute(p,v),h.fromBufferAttribute(p,v+1),ga.distanceSqToSegment(c,h,f,u)>l)continue;f.applyMatrix4(this.matrixWorld);let R=e.ray.origin.distanceTo(f);R<e.near||R>e.far||t.push({distance:R,point:u.clone().applyMatrix4(this.matrixWorld),index:v,face:null,faceIndex:null,object:this})}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}},rc=new D,ac=new D,xr=class extends Ha{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)rc.fromBufferAttribute(t,s),ac.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+rc.distanceTo(ac);e.setAttribute("lineDistance",new ct(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}};var vr=class i extends Ot{constructor(e=1,t=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:s},t=Math.max(3,t);let r=[],o=[],a=[],l=[],c=new D,h=new De;o.push(0,0,0),a.push(0,0,1),l.push(.5,.5);for(let u=0,f=3;u<=t;u++,f+=3){let g=n+u/t*s;c.x=e*Math.cos(g),c.y=e*Math.sin(g),o.push(c.x,c.y,c.z),a.push(0,0,1),h.x=(o[f]/e+1)/2,h.y=(o[f+1]/e+1)/2,l.push(h.x,h.y)}for(let u=1;u<=t;u++)r.push(u,u+1,0);this.setIndex(r),this.setAttribute("position",new ct(o,3)),this.setAttribute("normal",new ct(a,3)),this.setAttribute("uv",new ct(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}};var Va=class i extends Ot{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};let r=[],o=[];a(s),c(n),h(),this.setAttribute("position",new ct(r,3)),this.setAttribute("normal",new ct(r.slice(),3)),this.setAttribute("uv",new ct(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(M){let v=new D,T=new D,P=new D;for(let R=0;R<t.length;R+=3)g(t[R+0],v),g(t[R+1],T),g(t[R+2],P),l(v,T,P,M)}function l(M,v,T,P){let R=P+1,A=[];for(let X=0;X<=R;X++){A[X]=[];let b=M.clone().lerp(T,X/R),w=v.clone().lerp(T,X/R),N=R-X;for(let ee=0;ee<=N;ee++)ee===0&&X===R?A[X][ee]=b:A[X][ee]=b.clone().lerp(w,ee/N)}for(let X=0;X<R;X++)for(let b=0;b<2*(R-X)-1;b++){let w=Math.floor(b/2);b%2===0?(f(A[X][w+1]),f(A[X+1][w]),f(A[X][w])):(f(A[X][w+1]),f(A[X+1][w+1]),f(A[X+1][w]))}}function c(M){let v=new D;for(let T=0;T<r.length;T+=3)v.x=r[T+0],v.y=r[T+1],v.z=r[T+2],v.normalize().multiplyScalar(M),r[T+0]=v.x,r[T+1]=v.y,r[T+2]=v.z}function h(){let M=new D;for(let v=0;v<r.length;v+=3){M.x=r[v+0],M.y=r[v+1],M.z=r[v+2];let T=p(M)/2/Math.PI+.5,P=d(M)/Math.PI+.5;o.push(T,1-P)}_(),u()}function u(){for(let M=0;M<o.length;M+=6){let v=o[M+0],T=o[M+2],P=o[M+4],R=Math.max(v,T,P),A=Math.min(v,T,P);R>.9&&A<.1&&(v<.2&&(o[M+0]+=1),T<.2&&(o[M+2]+=1),P<.2&&(o[M+4]+=1))}}function f(M){r.push(M.x,M.y,M.z)}function g(M,v){let T=M*3;v.x=e[T+0],v.y=e[T+1],v.z=e[T+2]}function _(){let M=new D,v=new D,T=new D,P=new D,R=new De,A=new De,X=new De;for(let b=0,w=0;b<r.length;b+=9,w+=6){M.set(r[b+0],r[b+1],r[b+2]),v.set(r[b+3],r[b+4],r[b+5]),T.set(r[b+6],r[b+7],r[b+8]),R.set(o[w+0],o[w+1]),A.set(o[w+2],o[w+3]),X.set(o[w+4],o[w+5]),P.copy(M).add(v).add(T).divideScalar(3);let N=p(P);m(R,w+0,M,N),m(A,w+2,v,N),m(X,w+4,T,N)}}function m(M,v,T,P){P<0&&M.x===1&&(o[v]=M.x-1),T.x===0&&T.z===0&&(o[v]=P/2/Math.PI+.5)}function p(M){return Math.atan2(M.z,-M.x)}function d(M){return Math.atan2(-M.y,Math.sqrt(M.x*M.x+M.z*M.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.vertices,e.indices,e.radius,e.details)}};var yr=class i extends Va{constructor(e=1,t=0){let n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new i(e.radius,e.detail)}};var Mr=class i extends Ot{constructor(e=.5,t=1,n=32,s=1,r=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:s,thetaStart:r,thetaLength:o},n=Math.max(3,n),s=Math.max(1,s);let a=[],l=[],c=[],h=[],u=e,f=(t-e)/s,g=new D,_=new De;for(let m=0;m<=s;m++){for(let p=0;p<=n;p++){let d=r+p/n*o;g.x=u*Math.cos(d),g.y=u*Math.sin(d),l.push(g.x,g.y,g.z),c.push(0,0,1),_.x=(g.x/t+1)/2,_.y=(g.y/t+1)/2,h.push(_.x,_.y)}u+=f}for(let m=0;m<s;m++){let p=m*(n+1);for(let d=0;d<n;d++){let M=d+p,v=M,T=M+n+1,P=M+n+2,R=M+1;a.push(v,T,R),a.push(T,P,R)}}this.setIndex(a),this.setAttribute("position",new ct(l,3)),this.setAttribute("normal",new ct(c,3)),this.setAttribute("uv",new ct(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}};var en=class extends Gn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new Te(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Te(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Mc,this.normalScale=new De(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};function qs(i,e,t){return!i||!t&&i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function fg(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}var ki=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];n:{e:{let o;t:{i:if(!(e<s)){for(let a=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=s,s=t[++n],e<s)break e}o=t.length;break t}if(!(e>=r)){let a=t[1];e<a&&(n=2,r=a);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(s=r,r=t[--n-1],e>=r)break e}o=n,n=0;break t}break n}for(;n<o;){let a=n+o>>>1;e<t[a]?o=a:n=a+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let o=0;o!==s;++o)t[o]=n[r+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Ga=class extends ki{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:hl,endingEnd:hl}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,o=e+1,a=s[r],l=s[o];if(a===void 0)switch(this.getSettings_().endingStart){case ul:r=e,a=2*t-n;break;case dl:r=s.length-2,a=t+s[r]-s[r+1];break;default:r=e,a=n}if(l===void 0)switch(this.getSettings_().endingEnd){case ul:o=e,l=2*n-t;break;case dl:o=1,l=n+s[1]-s[0];break;default:o=e-1,l=t}let c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-a),this._weightNext=c/(l-n),this._offsetPrev=r*h,this._offsetNext=o*h}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,h=this._offsetPrev,u=this._offsetNext,f=this._weightPrev,g=this._weightNext,_=(n-t)/(s-t),m=_*_,p=m*_,d=-f*p+2*f*m-f*_,M=(1+f)*p+(-1.5-2*f)*m+(-.5+f)*_+1,v=(-1-g)*p+(1.5+g)*m+.5*_,T=g*p-g*m;for(let P=0;P!==a;++P)r[P]=d*o[h+P]+M*o[c+P]+v*o[l+P]+T*o[u+P];return r}},Wa=class extends ki{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,h=(n-t)/(s-t),u=1-h;for(let f=0;f!==a;++f)r[f]=o[c+f]*u+o[l+f]*h;return r}},Xa=class extends ki{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},ln=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=qs(t,this.TimeBufferType),this.values=qs(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:qs(e.times,Array),values:qs(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Xa(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Wa(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Ga(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Zs:t=this.InterpolantFactoryMethodDiscrete;break;case Js:t=this.InterpolantFactoryMethodLinear;break;case Yr:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Zs;case this.InterpolantFactoryMethodLinear:return Js;case this.InterpolantFactoryMethodSmooth:return Yr}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,o=s-1;for(;r!==s&&n[r]<e;)++r;for(;o!==-1&&n[o]>t;)--o;if(++o,r!==0||o!==s){r>=o&&(o=Math.max(o,1),r=o-1);let a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==r;a++){let l=n[a];if(typeof l=="number"&&isNaN(l)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(s!==void 0&&fg(s))for(let a=0,l=s.length;a!==l;++a){let c=s[a];if(isNaN(c)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===Yr,r=e.length-1,o=1;for(let a=1;a<r;++a){let l=!1,c=e[a],h=e[a+1];if(c!==h&&(a!==1||c!==e[0]))if(s)l=!0;else{let u=a*n,f=u-n,g=u+n;for(let _=0;_!==n;++_){let m=t[u+_];if(m!==t[f+_]||m!==t[g+_]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let u=a*n,f=o*n;for(let g=0;g!==n;++g)t[f+g]=t[u+g]}++o}}if(r>0){e[o]=e[r];for(let a=r*n,l=o*n,c=0;c!==n;++c)t[l+c]=t[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};ln.prototype.TimeBufferType=Float32Array;ln.prototype.ValueBufferType=Float32Array;ln.prototype.DefaultInterpolation=Js;var ri=class extends ln{};ri.prototype.ValueTypeName="bool";ri.prototype.ValueBufferType=Array;ri.prototype.DefaultInterpolation=Zs;ri.prototype.InterpolantFactoryMethodLinear=void 0;ri.prototype.InterpolantFactoryMethodSmooth=void 0;var qa=class extends ln{};qa.prototype.ValueTypeName="color";var Ya=class extends ln{};Ya.prototype.ValueTypeName="number";var Za=class extends ki{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(n-t)/(s-t),c=e*a;for(let h=c+a;c!==h;c+=4)an.slerpFlat(r,0,o,c-a,o,c,l);return r}},fs=class extends ln{InterpolantFactoryMethodLinear(e){return new Za(this.times,this.values,this.getValueSize(),e)}};fs.prototype.ValueTypeName="quaternion";fs.prototype.DefaultInterpolation=Js;fs.prototype.InterpolantFactoryMethodSmooth=void 0;var ai=class extends ln{};ai.prototype.ValueTypeName="string";ai.prototype.ValueBufferType=Array;ai.prototype.DefaultInterpolation=Zs;ai.prototype.InterpolantFactoryMethodLinear=void 0;ai.prototype.InterpolantFactoryMethodSmooth=void 0;var Ja=class extends ln{};Ja.prototype.ValueTypeName="vector";var $a=class{constructor(e,t,n){let s=this,r=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){a++,r===!1&&s.onStart!==void 0&&s.onStart(h,o,a),r=!0},this.itemEnd=function(h){o++,s.onProgress!==void 0&&s.onProgress(h,o,a),o===a&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){let u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,f=c.length;u<f;u+=2){let g=c[u],_=c[u+1];if(g.global&&(g.lastIndex=0),g.test(h))return _}return null}}},pg=new $a,Ka=class{constructor(e){this.manager=e!==void 0?e:pg,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}};Ka.DEFAULT_MATERIAL_NAME="__DEFAULT";var br=class extends ht{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Te(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),t}},Sr=class extends br{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(ht.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Te(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}},_a=new rt,oc=new D,lc=new D,ja=class{constructor(e){this.camera=e,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new De(512,512),this.map=null,this.mapPass=null,this.matrix=new rt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ls,this._frameExtents=new De(1,1),this._viewportCount=1,this._viewports=[new _t(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;oc.setFromMatrixPosition(e.matrixWorld),t.position.copy(oc),lc.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(lc),t.updateMatrixWorld(),_a.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(_a),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(_a)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}};var Qa=class extends ja{constructor(){super(new dr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},wr=class extends br{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ht.DEFAULT_UP),this.updateMatrix(),this.target=new ht,this.shadow=new Qa}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}};var Er=class{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=cc(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){let t=cc();e=(t-this.oldTime)/1e3,this.oldTime=t,this.elapsedTime+=e}return e}};function cc(){return(typeof performance>"u"?Date:performance).now()}var co="\\[\\]\\.:\\/",mg=new RegExp("["+co+"]","g"),ho="[^"+co+"]",gg="[^"+co.replace("\\.","")+"]",_g=/((?:WC+[\/:])*)/.source.replace("WC",ho),xg=/(WCOD+)?/.source.replace("WCOD",gg),vg=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",ho),yg=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",ho),Mg=new RegExp("^"+_g+xg+vg+yg+"$"),bg=["material","materials","bones","map"],eo=class{constructor(e,t,n){let s=n||nt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},nt=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(mg,"")}static parseTrackName(e){let t=Mg.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);bg.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let o=0;o<r.length;o++){let a=r[o];if(a.name===t||a.uuid===t)return a;let l=n(a.children);if(l)return l}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[s];if(o===void 0){let c=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.needsUpdate!==void 0?a=this.Versioning.NeedsUpdate:e.matrixWorldNeedsUpdate!==void 0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};nt.Composite=eo;nt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};nt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};nt.prototype.GetterByBindingType=[nt.prototype._getValue_direct,nt.prototype._getValue_array,nt.prototype._getValue_arrayElement,nt.prototype._getValue_toArray];nt.prototype.SetterByBindingTypeAndVersioning=[[nt.prototype._setValue_direct,nt.prototype._setValue_direct_setNeedsUpdate,nt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[nt.prototype._setValue_array,nt.prototype._setValue_array_setNeedsUpdate,nt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[nt.prototype._setValue_arrayElement,nt.prototype._setValue_arrayElement_setNeedsUpdate,nt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[nt.prototype._setValue_fromArray,nt.prototype._setValue_fromArray_setNeedsUpdate,nt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Gg=new Float32Array(1);var ps=class{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(At(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}};typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:to}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=to);var Ic={type:"change"},fo={type:"start"},Dc={type:"end"},Cr=new Oi,Uc=new rn,Sg=Math.cos(70*qt.DEG2RAD),Pr=class extends fn{constructor(e,t){super(),this.object=e,this.domElement=t,this.domElement.style.touchAction="none",this.enabled=!0,this.target=new D,this.cursor=new D,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:oi.ROTATE,MIDDLE:oi.DOLLY,RIGHT:oi.PAN},this.touches={ONE:li.ROTATE,TWO:li.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return a.phi},this.getAzimuthalAngle=function(){return a.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(E){E.addEventListener("keydown",B),this._domElementKeyEvents=E},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener("keydown",B),this._domElementKeyEvents=null},this.saveState=function(){n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=function(){n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(Ic),n.update(),r=s.NONE},this.update=function(){let E=new D,K=new an().setFromUnitVectors(e.up,new D(0,1,0)),ie=K.clone().invert(),se=new D,Se=new an,He=new D,qe=2*Math.PI;return function(oe=null){let C=n.object.position;E.copy(C).sub(n.target),E.applyQuaternion(K),a.setFromVector3(E),n.autoRotate&&r===s.NONE&&N(b(oe)),n.enableDamping?(a.theta+=l.theta*n.dampingFactor,a.phi+=l.phi*n.dampingFactor):(a.theta+=l.theta,a.phi+=l.phi);let ae=n.minAzimuthAngle,le=n.maxAzimuthAngle;isFinite(ae)&&isFinite(le)&&(ae<-Math.PI?ae+=qe:ae>Math.PI&&(ae-=qe),le<-Math.PI?le+=qe:le>Math.PI&&(le-=qe),ae<=le?a.theta=Math.max(ae,Math.min(le,a.theta)):a.theta=a.theta>(ae+le)/2?Math.max(ae,a.theta):Math.min(le,a.theta)),a.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,a.phi)),a.makeSafe(),n.enableDamping===!0?n.target.addScaledVector(h,n.dampingFactor):n.target.add(h),n.target.sub(n.cursor),n.target.clampLength(n.minTargetRadius,n.maxTargetRadius),n.target.add(n.cursor),n.zoomToCursor&&R||n.object.isOrthographicCamera?a.radius=J(a.radius):a.radius=J(a.radius*c),E.setFromSpherical(a),E.applyQuaternion(ie),C.copy(n.target).add(E),n.object.lookAt(n.target),n.enableDamping===!0?(l.theta*=1-n.dampingFactor,l.phi*=1-n.dampingFactor,h.multiplyScalar(1-n.dampingFactor)):(l.set(0,0,0),h.set(0,0,0));let Ce=!1;if(n.zoomToCursor&&R){let we=null;if(n.object.isPerspectiveCamera){let Ye=E.length();we=J(Ye*c);let Ze=Ye-we;n.object.position.addScaledVector(T,Ze),n.object.updateMatrixWorld()}else if(n.object.isOrthographicCamera){let Ye=new D(P.x,P.y,0);Ye.unproject(n.object),n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/c)),n.object.updateProjectionMatrix(),Ce=!0;let Ze=new D(P.x,P.y,0);Ze.unproject(n.object),n.object.position.sub(Ze).add(Ye),n.object.updateMatrixWorld(),we=E.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),n.zoomToCursor=!1;we!==null&&(this.screenSpacePanning?n.target.set(0,0,-1).transformDirection(n.object.matrix).multiplyScalar(we).add(n.object.position):(Cr.origin.copy(n.object.position),Cr.direction.set(0,0,-1).transformDirection(n.object.matrix),Math.abs(n.object.up.dot(Cr.direction))<Sg?e.lookAt(n.target):(Uc.setFromNormalAndCoplanarPoint(n.object.up,n.target),Cr.intersectPlane(Uc,n.target))))}else n.object.isOrthographicCamera&&(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/c)),n.object.updateProjectionMatrix(),Ce=!0);return c=1,R=!1,Ce||se.distanceToSquared(n.object.position)>o||8*(1-Se.dot(n.object.quaternion))>o||He.distanceToSquared(n.target)>0?(n.dispatchEvent(Ic),se.copy(n.object.position),Se.copy(n.object.quaternion),He.copy(n.target),!0):!1}}(),this.dispose=function(){n.domElement.removeEventListener("contextmenu",he),n.domElement.removeEventListener("pointerdown",G),n.domElement.removeEventListener("pointercancel",x),n.domElement.removeEventListener("wheel",Z),n.domElement.removeEventListener("pointermove",y),n.domElement.removeEventListener("pointerup",x),n._domElementKeyEvents!==null&&(n._domElementKeyEvents.removeEventListener("keydown",B),n._domElementKeyEvents=null)};let n=this,s={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},r=s.NONE,o=1e-6,a=new ps,l=new ps,c=1,h=new D,u=new De,f=new De,g=new De,_=new De,m=new De,p=new De,d=new De,M=new De,v=new De,T=new D,P=new De,R=!1,A=[],X={};function b(E){return E!==null?2*Math.PI/60*n.autoRotateSpeed*E:2*Math.PI/60/60*n.autoRotateSpeed}function w(E){let K=Math.abs(E)/(100*(window.devicePixelRatio|0));return Math.pow(.95,n.zoomSpeed*K)}function N(E){l.theta-=E}function ee(E){l.phi-=E}let ue=function(){let E=new D;return function(ie,se){E.setFromMatrixColumn(se,0),E.multiplyScalar(-ie),h.add(E)}}(),I=function(){let E=new D;return function(ie,se){n.screenSpacePanning===!0?E.setFromMatrixColumn(se,1):(E.setFromMatrixColumn(se,0),E.crossVectors(n.object.up,E)),E.multiplyScalar(ie),h.add(E)}}(),U=function(){let E=new D;return function(ie,se){let Se=n.domElement;if(n.object.isPerspectiveCamera){let He=n.object.position;E.copy(He).sub(n.target);let qe=E.length();qe*=Math.tan(n.object.fov/2*Math.PI/180),ue(2*ie*qe/Se.clientHeight,n.object.matrix),I(2*se*qe/Se.clientHeight,n.object.matrix)}else n.object.isOrthographicCamera?(ue(ie*(n.object.right-n.object.left)/n.object.zoom/Se.clientWidth,n.object.matrix),I(se*(n.object.top-n.object.bottom)/n.object.zoom/Se.clientHeight,n.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),n.enablePan=!1)}}();function q(E){n.object.isPerspectiveCamera||n.object.isOrthographicCamera?c/=E:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function Q(E){n.object.isPerspectiveCamera||n.object.isOrthographicCamera?c*=E:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function j(E,K){if(!n.zoomToCursor)return;R=!0;let ie=n.domElement.getBoundingClientRect(),se=E-ie.left,Se=K-ie.top,He=ie.width,qe=ie.height;P.x=se/He*2-1,P.y=-(Se/qe)*2+1,T.set(P.x,P.y,1).unproject(n.object).sub(n.object.position).normalize()}function J(E){return Math.max(n.minDistance,Math.min(n.maxDistance,E))}function te(E){u.set(E.clientX,E.clientY)}function re(E){j(E.clientX,E.clientX),d.set(E.clientX,E.clientY)}function fe(E){_.set(E.clientX,E.clientY)}function H(E){f.set(E.clientX,E.clientY),g.subVectors(f,u).multiplyScalar(n.rotateSpeed);let K=n.domElement;N(2*Math.PI*g.x/K.clientHeight),ee(2*Math.PI*g.y/K.clientHeight),u.copy(f),n.update()}function ne(E){M.set(E.clientX,E.clientY),v.subVectors(M,d),v.y>0?q(w(v.y)):v.y<0&&Q(w(v.y)),d.copy(M),n.update()}function de(E){m.set(E.clientX,E.clientY),p.subVectors(m,_).multiplyScalar(n.panSpeed),U(p.x,p.y),_.copy(m),n.update()}function ge(E){j(E.clientX,E.clientY),E.deltaY<0?Q(w(E.deltaY)):E.deltaY>0&&q(w(E.deltaY)),n.update()}function ye(E){let K=!1;switch(E.code){case n.keys.UP:E.ctrlKey||E.metaKey||E.shiftKey?ee(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):U(0,n.keyPanSpeed),K=!0;break;case n.keys.BOTTOM:E.ctrlKey||E.metaKey||E.shiftKey?ee(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):U(0,-n.keyPanSpeed),K=!0;break;case n.keys.LEFT:E.ctrlKey||E.metaKey||E.shiftKey?N(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):U(n.keyPanSpeed,0),K=!0;break;case n.keys.RIGHT:E.ctrlKey||E.metaKey||E.shiftKey?N(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):U(-n.keyPanSpeed,0),K=!0;break}K&&(E.preventDefault(),n.update())}function Le(E){if(A.length===1)u.set(E.pageX,E.pageY);else{let K=xe(E),ie=.5*(E.pageX+K.x),se=.5*(E.pageY+K.y);u.set(ie,se)}}function Ie(E){if(A.length===1)_.set(E.pageX,E.pageY);else{let K=xe(E),ie=.5*(E.pageX+K.x),se=.5*(E.pageY+K.y);_.set(ie,se)}}function Ee(E){let K=xe(E),ie=E.pageX-K.x,se=E.pageY-K.y,Se=Math.sqrt(ie*ie+se*se);d.set(0,Se)}function ke(E){n.enableZoom&&Ee(E),n.enablePan&&Ie(E)}function O(E){n.enableZoom&&Ee(E),n.enableRotate&&Le(E)}function Ke(E){if(A.length==1)f.set(E.pageX,E.pageY);else{let ie=xe(E),se=.5*(E.pageX+ie.x),Se=.5*(E.pageY+ie.y);f.set(se,Se)}g.subVectors(f,u).multiplyScalar(n.rotateSpeed);let K=n.domElement;N(2*Math.PI*g.x/K.clientHeight),ee(2*Math.PI*g.y/K.clientHeight),u.copy(f)}function be(E){if(A.length===1)m.set(E.pageX,E.pageY);else{let K=xe(E),ie=.5*(E.pageX+K.x),se=.5*(E.pageY+K.y);m.set(ie,se)}p.subVectors(m,_).multiplyScalar(n.panSpeed),U(p.x,p.y),_.copy(m)}function Pe(E){let K=xe(E),ie=E.pageX-K.x,se=E.pageY-K.y,Se=Math.sqrt(ie*ie+se*se);M.set(0,Se),v.set(0,Math.pow(M.y/d.y,n.zoomSpeed)),q(v.y),d.copy(M);let He=(E.pageX+K.x)*.5,qe=(E.pageY+K.y)*.5;j(He,qe)}function Me(E){n.enableZoom&&Pe(E),n.enablePan&&be(E)}function W(E){n.enableZoom&&Pe(E),n.enableRotate&&Ke(E)}function G(E){n.enabled!==!1&&(A.length===0&&(n.domElement.setPointerCapture(E.pointerId),n.domElement.addEventListener("pointermove",y),n.domElement.addEventListener("pointerup",x)),_e(E),E.pointerType==="touch"?pe(E):L(E))}function y(E){n.enabled!==!1&&(E.pointerType==="touch"?ce(E):Y(E))}function x(E){Re(E),A.length===0&&(n.domElement.releasePointerCapture(E.pointerId),n.domElement.removeEventListener("pointermove",y),n.domElement.removeEventListener("pointerup",x)),n.dispatchEvent(Dc),r=s.NONE}function L(E){let K;switch(E.button){case 0:K=n.mouseButtons.LEFT;break;case 1:K=n.mouseButtons.MIDDLE;break;case 2:K=n.mouseButtons.RIGHT;break;default:K=-1}switch(K){case oi.DOLLY:if(n.enableZoom===!1)return;re(E),r=s.DOLLY;break;case oi.ROTATE:if(E.ctrlKey||E.metaKey||E.shiftKey){if(n.enablePan===!1)return;fe(E),r=s.PAN}else{if(n.enableRotate===!1)return;te(E),r=s.ROTATE}break;case oi.PAN:if(E.ctrlKey||E.metaKey||E.shiftKey){if(n.enableRotate===!1)return;te(E),r=s.ROTATE}else{if(n.enablePan===!1)return;fe(E),r=s.PAN}break;default:r=s.NONE}r!==s.NONE&&n.dispatchEvent(fo)}function Y(E){switch(r){case s.ROTATE:if(n.enableRotate===!1)return;H(E);break;case s.DOLLY:if(n.enableZoom===!1)return;ne(E);break;case s.PAN:if(n.enablePan===!1)return;de(E);break}}function Z(E){n.enabled===!1||n.enableZoom===!1||r!==s.NONE||(E.preventDefault(),n.dispatchEvent(fo),ge(E),n.dispatchEvent(Dc))}function B(E){n.enabled===!1||n.enablePan===!1||ye(E)}function pe(E){switch($(E),A.length){case 1:switch(n.touches.ONE){case li.ROTATE:if(n.enableRotate===!1)return;Le(E),r=s.TOUCH_ROTATE;break;case li.PAN:if(n.enablePan===!1)return;Ie(E),r=s.TOUCH_PAN;break;default:r=s.NONE}break;case 2:switch(n.touches.TWO){case li.DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;ke(E),r=s.TOUCH_DOLLY_PAN;break;case li.DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;O(E),r=s.TOUCH_DOLLY_ROTATE;break;default:r=s.NONE}break;default:r=s.NONE}r!==s.NONE&&n.dispatchEvent(fo)}function ce(E){switch($(E),r){case s.TOUCH_ROTATE:if(n.enableRotate===!1)return;Ke(E),n.update();break;case s.TOUCH_PAN:if(n.enablePan===!1)return;be(E),n.update();break;case s.TOUCH_DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;Me(E),n.update();break;case s.TOUCH_DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;W(E),n.update();break;default:r=s.NONE}}function he(E){n.enabled!==!1&&E.preventDefault()}function _e(E){A.push(E.pointerId)}function Re(E){delete X[E.pointerId];for(let K=0;K<A.length;K++)if(A[K]==E.pointerId){A.splice(K,1);return}}function $(E){let K=X[E.pointerId];K===void 0&&(K=new De,X[E.pointerId]=K),K.set(E.pageX,E.pageY)}function xe(E){let K=E.pointerId===A[0]?A[1]:A[0];return X[K]}n.domElement.addEventListener("contextmenu",he),n.domElement.addEventListener("pointerdown",G),n.domElement.addEventListener("pointercancel",x),n.domElement.addEventListener("wheel",Z,{passive:!1}),this.update()}};var ms=class i extends ot{constructor(){let e=i.SkyShader,t=new on({name:e.name,uniforms:oo.clone(e.uniforms),vertexShader:e.vertexShader,fragmentShader:e.fragmentShader,side:Rt,depthWrite:!1});super(new si(1,1,1),t),this.isSky=!0}};ms.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new D},up:{value:new D(0,1,0)}},vertexShader:`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;
		uniform vec3 up;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		// constants for atmospheric scattering
		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		// wavelength of used primaries, according to preetham
		const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
		// this pre-calcuation replaces older TotalRayleigh(vec3 lambda) function:
		// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
		const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

		// mie stuff
		// K coefficient for the primaries
		const float v = 4.0;
		const vec3 K = vec3( 0.686, 0.678, 0.666 );
		// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
		const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

		// earth shadow hack
		// cutoffAngle = pi / 1.95;
		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {
			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
			return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
		}

		vec3 totalMie( float T ) {
			float c = ( 0.2 * T ) * 10E-18;
			return 0.434 * c * MieConst;
		}

		void main() {

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vWorldPosition = worldPosition.xyz;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			gl_Position.z = gl_Position.w; // set z to camera.far

			vSunDirection = normalize( sunPosition );

			vSunE = sunIntensity( dot( vSunDirection, up ) );

			vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

			float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

			// extinction (absorbtion + out scattering)
			// rayleigh coefficients
			vBetaR = totalRayleigh * rayleighCoefficient;

			// mie coefficients
			vBetaM = totalMie( turbidity ) * mieCoefficient;

		}`,fragmentShader:`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;
		uniform vec3 up;

		// constants for atmospheric scattering
		const float pi = 3.141592653589793238462643383279502884197169;

		const float n = 1.0003; // refractive index of air
		const float N = 2.545E25; // number of molecules per unit volume for air at 288.15K and 1013mb (sea level -45 celsius)

		// optical length at zenith for molecules
		const float rayleighZenithLength = 8.4E3;
		const float mieZenithLength = 1.25E3;
		// 66 arc seconds -> degrees, and the cosine of that
		const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

		// 3.0 / ( 16.0 * pi )
		const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
		// 1.0 / ( 4.0 * pi )
		const float ONE_OVER_FOURPI = 0.07957747154594767;

		float rayleighPhase( float cosTheta ) {
			return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
		}

		float hgPhase( float cosTheta, float g ) {
			float g2 = pow( g, 2.0 );
			float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
			return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
		}

		void main() {

			vec3 direction = normalize( vWorldPosition - cameraPosition );

			// optical length
			// cutoff angle at 90 to avoid singularity in next formula.
			float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
			float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
			float sR = rayleighZenithLength * inverse;
			float sM = mieZenithLength * inverse;

			// combined extinction factor
			vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

			// in scattering
			float cosTheta = dot( direction, vSunDirection );

			float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
			vec3 betaRTheta = vBetaR * rPhase;

			float mPhase = hgPhase( cosTheta, mieDirectionalG );
			vec3 betaMTheta = vBetaM * mPhase;

			vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
			Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

			// nightsky
			float theta = acos( direction.y ); // elevation --> y-axis, [-pi/2, pi/2]
			float phi = atan( direction.z, direction.x ); // azimuth --> x-axis [-pi/2, pi/2]
			vec2 uv = vec2( phi, theta ) / vec2( 2.0 * pi, pi ) + vec2( 0.5, 0.0 );
			vec3 L0 = vec3( 0.1 ) * Fex;

			// composition + solar disc
			float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );
			L0 += ( vSunE * 19000.0 * Fex ) * sundisk;

			vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

			vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );

			gl_FragColor = vec4( retColor, 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};function pn(i){let e=i>>>0;return function(){e|=0,e=e+1831565813|0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}function mo(i){let e=Math.abs(i|0);return[e%89*1.71+3.1,e%57*2.33+7.7]}function wg(){function i(n,s){let r=Math.imul(n|0,374761393)+Math.imul(s|0,668265263)|0;return r=Math.imul(r^r>>>13,1274126177),r=(r^r>>>16)>>>0,r/4294967296}function e(n,s){let r=Math.floor(n),o=Math.floor(s),a=n-r,l=s-o;a=a*a*(3-2*a),l=l*l*(3-2*l);let c=i(r,o),h=i(r+1,o),u=i(r,o+1),f=i(r+1,o+1);return c+(h-c)*a+(u-c)*l+(c-h-u+f)*a*l}function t(n,s){return .5*e(n,s)+.3*e(n*2.03+11.7,s*2.03+5.3)+.2*e(n*4.11+7.9,s*4.11+3.1)}return{noise2:e,fbm3:t}}var gs=class{constructor(e){let t=new Uint8Array(256);for(let n=0;n<256;n++)t[n]=n;for(let n=255;n>0;n--){let s=e()*(n+1)|0,r=t[n];t[n]=t[s],t[s]=r}this.p=new Uint8Array(512);for(let n=0;n<512;n++)this.p[n]=t[n&255]}fade(e){return e*e*e*(e*(e*6-15)+10)}grad(e,t,n){switch(e&7){case 0:return t+n;case 1:return t-n;case 2:return-t+n;case 3:return-t-n;case 4:return t;case 5:return-t;case 6:return n;default:return-n}}noise(e,t){let n=Math.floor(e),s=Math.floor(t),r=n&255,o=s&255;e-=n,t-=s;let a=this.fade(e),l=this.fade(t),c=this.p,h=c[c[r]+o],u=c[c[r]+o+1],f=c[c[r+1]+o],g=c[c[r+1]+o+1],_=Ct(this.grad(h,e,t),this.grad(f,e-1,t),a),m=Ct(this.grad(u,e,t-1),this.grad(g,e-1,t-1),a);return Ct(_,m,l)*1.41421356}};function Eg(i,e,t,n=4,s=2.02,r=.5){let o=.5,a=1,l=0,c=0;for(let h=0;h<n;h++)l+=o*i.noise(e*a,t*a),c+=o,o*=r,a*=s;return l/c}function po(i,e,t,n=3,s=2.1,r=.5){let o=.5,a=1,l=0,c=0;for(let h=0;h<n;h++)l+=o*(1-Math.abs(i.noise(e*a,t*a))),c+=o,o*=r,a*=s;return l/c}var Zt=(i,e,t)=>i<e?e:i>t?t:i,Ct=(i,e,t)=>i+(e-i)*t;function Yt(i,e,t){let n=Zt((t-i)/(e-i),0,1);return n*n*(3-2*n)}function Nc(i,e,t,n,s,r){let o=s-t,a=r-n,l=o*o+a*a,c=l>0?((i-t)*o+(e-n)*a)/l:0;c=Zt(c,0,1);let h=t+o*c-i,u=n+a*c-e;return{d:Math.sqrt(h*h+u*u),t:c}}var mn={grand:{label:"Grand Canyon",world:2400,depth:320,gorgeDepth:60,rimHalf:620,bedHalf:42,gorgeHalf:100,terraces:6,terraceMix:.7,profilePow:1.3,plateauAmp:14,meander1:.1,meander2:.035,meanderF1:1.6,meanderF2:3.7,wiggle:0,tributary:!0,buttes:5,dunes:0,braided:!1,waterDepth:2.4,warpAmp:20,warpFreq:.004,aoStrength:.03,topY:34,rocks:900,rockMin:.8,rockMax:6,bushes:450,lakeCount:3,lakeRMin:50,lakeRMax:130,lakeDepth:7,camPos:[980,560,1180],camTgt:[0,-140,0]},slot:{label:"Slot Canyon",world:420,depth:46,gorgeDepth:0,rimHalf:62,bedHalf:4,gorgeHalf:0,terraces:2,terraceMix:.25,profilePow:1.05,plateauAmp:5,meander1:.16,meander2:.05,meanderF1:2.2,meanderF2:5.1,wiggle:.008,tributary:!1,buttes:0,dunes:0,braided:!1,waterDepth:1,warpAmp:4,warpFreq:.02,aoStrength:.14,topY:14,rocks:160,rockMin:.3,rockMax:1.6,bushes:0,lakeCount:0,lakeRMin:0,lakeRMax:0,lakeDepth:0,camPos:[150,72,196],camTgt:[0,-16,0]},wadi:{label:"Desert Wadi",world:1700,depth:30,gorgeDepth:0,rimHalf:430,bedHalf:95,gorgeHalf:0,terraces:2,terraceMix:.2,profilePow:1.7,plateauAmp:9,meander1:.08,meander2:.03,meanderF1:1.4,meanderF2:3.2,wiggle:0,tributary:!1,buttes:2,dunes:7,braided:!0,waterDepth:.5,warpAmp:8,warpFreq:.006,aoStrength:.06,topY:24,rocks:350,rockMin:.5,rockMax:3,bushes:260,lakeCount:1,lakeRMin:80,lakeRMax:150,lakeDepth:3,camPos:[700,390,920],camTgt:[0,-8,0]}},Tg={grand:[.06,.06,.07,.06,.11,.08,.1,.1,.06,.11,.08,.11],slot:[.09,.07,.1,.06,.11,.08,.09,.07,.1,.06,.09,.08],wadi:[.08,.08,.09,.07,.1,.09,.08,.08,.09,.07,.09,.08]},Lr={classic:{label:"Canyon Classic",cols:[3682606,6047794,7305810,10910555,8269606,10245686,11822655,13208154,9323576,14267532,12166014,13221800],hard:[.95,.8,.3,.6,.9,.5,.45,.6,.25,.85,.7,.9],xbed:[0,0,0,0,0,1,1,0,0,1,0,0]},antelope:{label:"Antelope Red",cols:[6168600,9318946,12999221,15246699,10500648,14252874,8006176,14925962,12077614,15251576,13201989,9320996],hard:[.8,.75,.7,.65,.8,.7,.85,.6,.75,.6,.7,.8],xbed:[0,1,0,1,0,1,0,1,0,1,0,0]},sahara:{label:"Sahara Gold",cols:[8219477,10126695,13218179,12163950,14271642,11112294,13876370,12888188,14930862,12166014,14271642,13350545],hard:[.6,.5,.55,.45,.5,.4,.55,.5,.45,.5,.55,.6],xbed:[0,0,0,0,0,0,0,0,0,0,0,0]},painted:{label:"Painted Desert",cols:[6180702,8019822,10122118,12159626,14262410,15254426,13215882,11043450,9071218,12163744,14271154,15260872],hard:[.55,.45,.5,.4,.45,.5,.55,.45,.4,.5,.55,.6],xbed:[0,0,1,0,1,0,0,1,0,0,1,0]},bryce:{label:"Bryce Amphitheater",cols:[9062970,12081728,14252624,15243880,15775875,16044192,15251600,14256752,12606024,14719608,15911844,16245700],hard:[.7,.5,.6,.45,.55,.4,.5,.6,.7,.5,.45,.55],xbed:[1,0,1,0,1,0,1,0,0,1,0,0]},basalt:{label:"Basalt Mono",cols:[3025964,3815221,2762792,4538944,3354929,4867650,3025962,4143928,3552307,4999236,3683636,5525578],hard:[.95,.9,.92,.85,.9,.88,.93,.86,.9,.85,.88,.9],xbed:[0,0,0,0,0,0,0,0,0,0,0,0]}},Ag={grand:"classic",slot:"antelope",wadi:"sahara"};function go(i,e){return e&&Lr[e]?e:Ag[i]||"classic"}function Rg(i,e,t){let n=mn[i],s=Lr[go(i,t)],r=Tg[i],o=e-10,a=n.topY,l=[o],c=0;for(let h=0;h<12;h++)c+=r[h],l.push(o+(a-o)*Math.min(c,1));return{bounds:l,cols:s.cols.slice(),hard:s.hard.slice(),xbed:s.xbed.slice()}}function Cg(i,e){let t=i.bounds;for(let n=0;n<12;n++)if(e<t[n+1])return i.hard[n];return i.hard[11]}function Fc(i,e,t,n,s,r){if(i>=e)return 0;if(i<=t)return 1;let o=1-(i-t)/(e-t),a=Math.pow(o,n),l=a*s,c=Math.floor(l),h=l-c;h=h*h*(3-2*h);let u=(Math.min(c,s-1)+h)/s;return a*(1-r)+u*r}function _o({G:i,hardGrid:e,distMain:t,N:n,bedHalf:s,lakes:r}){let o=new Uint8Array(n*n),a=2,l=[],c=[];for(let _=-a;_<=a;_++)for(let m=-a;m<=a;m++){let p=m*m+_*_;p<=a*a&&(l.push(_*n+m),c.push(1-Math.sqrt(p)/(a+1)))}let h=0;for(let _=0;_<c.length;_++)h+=c[_];for(let _=0;_<c.length;_++)c[_]/=h;function u(_,m){let d=Math.max(_-3,0),M=Math.min(_+3,n-1),v=Math.max(m-3,0),T=Math.min(m+3,n-1);for(let P=v;P<=T;P++){let R=P*n;for(let A=d;A<=M;A++)o[R+A]=1}}function f(_,m){let p=0;if(t){let d=t[m*n+_];d<s*3&&(p=Math.max(p,1-Yt(s,s*3,d)))}if(r)for(let d=0;d<r.length;d++){let M=r[d],v=_-M.gx,T=m-M.gz;v*v+T*T<M.gr*M.gr&&(p=Math.max(p,.95))}return p}function g(_,m,p=1,d=!1,M=null){let R=.3*p,A=.3,X=.01,b=4,w=a,N=n-1-a,ee=6e3;for(let ue=0;ue<_;ue++){let I=w+m()*(N-w),U=w+m()*(N-w),q=0,Q=0,j=1,J=1,te=0;for(let re=0;re<30;re++){let fe=Math.floor(I),H=Math.floor(U),ne=I-fe,de=U-H,ge=H*n+fe,ye=i[ge],Le=i[ge+1],Ie=i[ge+n],Ee=i[ge+n+1],ke=(Le-ye)*(1-de)+(Ee-Ie)*de,O=(Ie-ye)*(1-ne)+(Ee-Le)*ne,Ke=ye+(Le-ye)*ne+(Ie-ye)*de+(ye-Le-Ie+Ee)*ne*de;q=q*.05-ke*(1-.05),Q=Q*.05-O*(1-.05);let be=Math.sqrt(q*q+Q*Q);if(be<1e-6){let $=m()*Math.PI*2;q=Math.cos($),Q=Math.sin($)}else q/=be,Q/=be;let Pe=I+q,Me=U+Q;if(Pe<w||Pe>N-1||Me<w||Me>N-1)break;let W=Math.floor(Pe),G=Math.floor(Me),y=Pe-W,x=Me-G,L=G*n+W,Y=i[L],B=Y+(i[L+1]-Y)*y+(i[L+n]-Y)*x+(Y-i[L+1]-i[L+n]+i[L+n+1])*y*x-Ke,ce=(1.35-e[H*n+fe])*p,he=1;d&&(he=1-f(fe,H)*.97);let _e=Math.max(-B*j*J*4,.001);if(te>_e||B>0){let $=(B>0?Math.min(B,te):(te-_e)*A)*he;te-=$,i[ge]+=$*(1-ne)*(1-de),i[ge+1]+=$*ne*(1-de),i[ge+n]+=$*(1-ne)*de,i[ge+n+1]+=$*ne*de}else{let $=(_e-te)*R*ce*he,xe=-B+.001;$>xe&&($=xe),$<0&&($=0),te+=$;for(let E=0;E<l.length;E++){let K=ge+l[E],ie=i[K]-$*c[E];i[K]=ie<0?0:ie}}let Re=j*j+-B*b;j=Math.sqrt(Re>0?Re:0),J*=1-X,I=Pe,U=Me,u(fe,H)}M&&ue%ee===ee-1&&M(ue,_)}}return{runDroplets:g,dirty:o,protection:f}}async function Oc({type:i="grand",seed:e=2026,size:t=512,erosion:n=1,strata:s=null,onProgress:r=null}){let o=typeof performance<"u"?performance.now():Date.now(),a=mn[i];if(!a)throw new Error("Unknown canyon type: "+i);let l=(W,G)=>{if(r)try{r(W,G)}catch{}},c=()=>new Promise(W=>setTimeout(W,0));l(.02,"Seeding random streams"),await c();let h=pn(e),u=new gs(pn((e^2654435769)>>>0)),f=wg(),[g,_]=mo(e),m=t,p=a.world,d=p/2,M=a.depth+(a.gorgeDepth||0),v=-M,T=v+a.waterDepth,P=h()*Math.PI*2,R=h()*Math.PI*2,A=h()*Math.PI*2,X=e%100*.37,b=new Float32Array(m);for(let W=0;W<m;W++){let G=W/(m-1),y=Math.sin(G*Math.PI*2*a.meanderF1+P)*a.meander1*p+Math.sin(G*Math.PI*2*a.meanderF2+R)*a.meander2*p+u.noise(3.1+X,G*4)*p*.02;a.wiggle&&(y+=Math.sin(G*43+A)*a.wiggle*p),b[W]=y}let w=W=>{let G=Zt(W/p+.5,0,1)*(m-1),y=Math.floor(G),x=G-y;return Ct(b[y],b[Math.min(m-1,y+1)],x)},N=null;if(a.tributary){let G=(.55+h()*.2-.5)*p,y=w(G),x=h()<.5?-1:1,L=h()<.5?-1:1,Y=x*d*.99,Z=Zt(G+L*p*(.28+h()*.12),-d*.99,d*.99),B=Ct(Y,y,.5)+(h()-.5)*p*.1,pe=Ct(Z,G,.5)+(h()-.5)*p*.1;N={ax:Y,az:Z,mx:B,mz:pe,bx:y,bz:G,rimHalf:a.rimHalf*.3,depth:a.depth*.55,bedHalf:a.bedHalf*.45}}let ee=[];if(a.buttes){let W=0;for(;ee.length<a.buttes&&W++<80;){let G=(h()*2-1)*d*.8,y=(h()*2-1)*d*.8;Math.abs(G-w(y))<a.rimHalf*1.25||ee.push({x:G,z:y,r:p*(.035+h()*.05),h:a.depth*(.22+h()*.28)})}}function ue(W,G){if(!N)return{d:1e9,t:0};let y=Nc(W,G,N.ax,N.az,N.mx,N.mz),x=Nc(W,G,N.mx,N.mz,N.bx,N.bz);return y.d<x.d?{d:y.d,t:y.t*.5}:{d:x.d,t:.5+x.t*.5}}let I=[];if(a.lakeCount){let W=0;for(;I.length<a.lakeCount&&W++<120;){let G=a.lakeRMin+h()*(a.lakeRMax-a.lakeRMin),y=(h()*2-1)*(d-G-30),x=(h()*2-1)*(d-G-30);if(Math.abs(y-w(x))<a.rimHalf*1.35+G||ue(y,x).d<a.rimHalf*.32+G)continue;let Y=!1;for(let Z=0;Z<ee.length;Z++){let B=ee[Z];if(Math.hypot(y-B.x,x-B.z)<B.r+G+40){Y=!0;break}}if(!Y){for(let Z=0;Z<I.length;Z++)if(Math.hypot(y-I[Z].x,x-I[Z].z)<I[Z].r+G+60){Y=!0;break}Y||I.push({x:y,z:x,r:G,depth:a.lakeDepth*(.8+h()*.4),waterY:0})}}}let U=new Float32Array(m*m),q=new Float32Array(m*m);l(.05,"Carving canyon...");for(let W=0;W<m;W++){let G=-d+p*W/(m-1),y=W/(m-1),x=b[W],L=1+.28*u.noise(y*3.1+11,4.4),Y=1+.1*u.noise(.5,y*2.3+7),Z=Math.max(a.rimHalf*L,a.bedHalf*4);for(let B=0;B<m;B++){let pe=-d+p*B/(m-1),ce=W*m+B,he=Math.abs(pe-x);q[ce]=he;let _e=u.noise(pe*.0016,G*.0016)*a.plateauAmp+Eg(u,pe*.008,G*.008,3)*a.plateauAmp*.18;for(let xe=0;xe<ee.length;xe++){let E=ee[xe],K=pe-E.x,ie=G-E.z,se=Math.sqrt(K*K+ie*ie);se<E.r&&(_e+=E.h*Math.pow(Yt(E.r,E.r*.42,se),.85))}if(a.dunes){let xe=Yt(Z,Z*1.7,he);xe>0&&(_e+=xe*a.dunes*po(u,pe*.004+3,G*.004,3))}let Re=M*Y*Fc(he,Z,a.bedHalf,a.profilePow,a.terraces,a.terraceMix);if(a.gorgeDepth){let xe=1-Yt(0,a.gorgeHalf*L,he);xe>0&&(Re+=a.gorgeDepth*Math.pow(xe,1.4))}if(N){let xe=ue(pe,G),E=a.rimHalf*Ct(.2,.32,xe.t),K=Ct(150,M*Y,Math.pow(xe.t,.75));if(xe.d<E){let ie=K*Fc(xe.d,E,N.bedHalf,1.2,3,.6);ie>Re&&(Re=ie)}N._d=xe.d,N._t=xe.t}if(_e-=Re,N){let xe=Yt(.8,.98,N._t)*(1-Yt(N.bedHalf,N.bedHalf*3,N._d));xe>0&&(_e=Ct(_e,v+u.noise(pe*.05+4,G*.05)*.5,xe))}let $=1-Yt(a.bedHalf*.9,a.bedHalf*3,he);if($>0){let xe=v+u.noise(pe*.05,G*.05)*.5;a.braided&&(xe+=(po(u,pe*.015,G*.008+9,2)-.55)*3.2),_e=Ct(_e,xe,$)}U[ce]=_e}(W&63)===63&&(l(.05+.25*W/m,"Carving canyon..."),await c())}l(.32,"Measuring terrain..."),await c();let Q=1/0,j=-1/0;for(let W=0;W<m*m;W++){let G=U[W];G<Q&&(Q=G),G>j&&(j=G)}let J=Math.max(j-Q,1e-6),te=new Float32Array(m*m);for(let W=0;W<m*m;W++)te[W]=(U[W]-Q)/J;l(.34,"Surveying rock hardness..."),await c();let re=Rg(i,v),fe=new Float32Array(m*m);for(let W=0;W<m;W++){let G=-d+p*W/(m-1);for(let y=0;y<m;y++){let x=-d+p*y/(m-1),L=W*m+y,Y=f.fbm3(x*a.warpFreq+g,G*a.warpFreq+_);fe[L]=Cg(re,U[L]+(Y-.5)*2*a.warpAmp)}(W&127)===127&&(l(.34+.02*W/m,"Surveying rock hardness..."),await c())}let H=Math.min(34e4,Math.floor(m*m*.55*n)),ne=_o({G:te,hardGrid:fe,distMain:null,N:m,bedHalf:a.bedHalf,lakes:null});if(H>0){let W=pn((e^1374496521)>>>0),G=0;for(;G<H;){let y=Math.min(12e3,H-G);ne.runDroplets(y,W,1,!1,null),G+=y,l(.36+.4*G/H,`Eroding with rain (${Math.round(100*G/H)}%)`),await c()}}let de=Math.round(28*n);if(de>0){l(.78,"Settling talus slopes..."),await c();let W=p/(m-1),G=Math.tan(34*Math.PI/180)*W/J,y=new Float32Array(m*m);for(let x=0;x<de;x++){y.fill(0);for(let L=1;L<m-1;L++){let Y=L*m;for(let Z=1;Z<m-1;Z++){let B=Y+Z,pe=te[B],ce=B,he=pe,_e=te[B-1],Re=te[B+1],$=te[B-m],xe=te[B+m];_e<he&&(he=_e,ce=B-1),Re<he&&(he=Re,ce=B+1),$<he&&(he=$,ce=B-m),xe<he&&(he=xe,ce=B+m);let E=pe-he;if(E>G){let K=(E-G)*.35*(1.25-fe[B]);y[B]-=K,y[ce]+=K}}}for(let L=0;L<m*m;L++)te[L]+=y[L];(x&7)===7&&(l(.78+.08*x/de,"Settling talus slopes..."),await c())}}for(let W=0;W<m*m;W++)U[W]=Q+te[W]*J;for(let W=0;W<m;W++){let G=-d+p*W/(m-1);for(let y=0;y<m;y++){let x=W*m+y,L=q[x];if(L<a.bedHalf*3){let Y=-d+p*y/(m-1),Z=v+u.noise(Y*.05,G*.05)*.5;a.braided&&(Z+=(po(u,Y*.015,G*.008+9,2)-.55)*3.2);let B=1-Yt(a.bedHalf*.9,a.bedHalf*3,L);U[x]=L<a.bedHalf?Z:Ct(U[x],Z,B*.9),!a.braided&&L<a.bedHalf&&U[x]>T-.3&&(U[x]=T-.3)}}}if(N)for(let W=0;W<m;W++){let G=-d+p*W/(m-1);for(let y=0;y<m;y++){let x=-d+p*y/(m-1),L=ue(x,G);if(L.t<.8)continue;let Y=Yt(.8,.98,L.t)*(1-Yt(N.bedHalf,N.bedHalf*3,L.d));if(Y>0){let Z=W*m+y,B=L.t>.93&&L.d<N.bedHalf?1:Y*.9;U[Z]=Ct(U[Z],v+u.noise(x*.05+4,G*.05)*.5,B)}}}for(let W=0;W<I.length;W++){let G=I[W],y=Math.ceil(G.r/p*(m-1))+1,x=Math.round((G.x+d)/p*(m-1)),L=Math.round((G.z+d)/p*(m-1));G.gx=x,G.gz=L,G.gr=y;for(let Y=Math.max(L-y,0);Y<=Math.min(L+y,m-1);Y++){let Z=-d+p*Y/(m-1);for(let B=Math.max(x-y,0);B<=Math.min(x+y,m-1);B++){let pe=-d+p*B/(m-1),ce=Math.hypot(pe-G.x,Z-G.z);if(ce<G.r){let he=.5+.5*Math.cos(Math.PI*ce/G.r);U[Y*m+B]-=G.depth*Math.pow(he,1.2)}}}G.waterY=U[L*m+x]+G.depth*.5}l(.9,"Baking ambient occlusion..."),await c();let ge=Math.max(2,m>>7),ye=new Float32Array(m*m);for(let W=0;W<m;W++){let G=W*m;for(let y=0;y<m;y++){let x=0,L=0;for(let Y=-ge;Y<=ge;Y++)x+=U[G+Zt(y+Y,0,m-1)],L++;ye[G+y]=x/L}}l(.94,"Baking ambient occlusion..."),await c();let Le=new Float32Array(m*m);for(let W=0;W<m;W++)for(let G=0;G<m;G++){let y=0,x=0;for(let L=-ge;L<=ge;L++)y+=ye[Zt(W+L,0,m-1)*m+G],x++;Le[W*m+G]=y/x}let Ie=0,Ee=0;for(let W=0;W<m*m;W++)q[W]>a.rimHalf*1.2&&(Ie+=U[W],Ee++);let ke=Ee?Ie/Ee:0,O=new Float32Array(m*m);for(let W=0;W<m*m;W++){let G=1-(Le[W]-U[W])*a.aoStrength;G*=Ct(.45,1,Yt(v,ke,U[W])),O[W]=Zt(G,0,1)}l(.96,"Tracing water flow..."),await c();let Ke=new Uint8Array(m*m*4),be=p/(m-1),Pe=a.waterDepth*3+1;for(let W=0;W<m;W++){let G=W>0?W-1:0,y=W<m-1?W+1:m-1,x=(b[y]-b[G])/(Math.max(y-G,1)*be),L=1,Y=Math.hypot(x,L)||1;x/=Y,L/=Y;let Z=-d+p*W/(m-1);for(let B=0;B<m;B++){let pe=W*m+B,ce=U[W*m+Math.max(B-1,0)],he=U[W*m+Math.min(B+1,m-1)],_e=U[Math.max(W-1,0)*m+B],Re=U[Math.min(W+1,m-1)*m+B],$=(he-ce)/(2*be),xe=(Re-_e)/(2*be),E=Math.hypot($,xe),K=E>1e-6?-$/E:x,ie=E>1e-6?-xe/E:L,se=1-Yt(a.bedHalf*1.5,a.bedHalf*4,q[pe]);if(se>0){K=K*(1-se)+x*se,ie=ie*(1-se)+L*se;let oe=Math.hypot(K,ie)||1;K/=oe,ie/=oe}if(N){let oe=-d+p*B/(m-1),C=ue(oe,Z),ae=1-Yt(N.bedHalf,N.bedHalf*3,C.d);if(ae>0){let le=N.bx-oe,Ce=N.bz-Z,we=Math.hypot(le,Ce)||1;le/=we,Ce/=we,K=K*(1-ae)+le*ae,ie=ie*(1-ae)+Ce*ae;let Ye=Math.hypot(K,ie)||1;K/=Ye,ie/=Ye}}let Se=1;for(let oe=0;oe<I.length;oe++){let C=I[oe],ae=B-C.gx,le=W-C.gz;if(ae*ae+le*le<C.gr*C.gr*.81){Se=.06;break}}let He=Zt(Zt(E*1.5,0,1)*.5+se*.45+.05,0,1)*Se,qe=Zt((T-U[pe])/Pe,0,1),Oe=pe*4;Ke[Oe]=Math.round((K*.5+.5)*255),Ke[Oe+1]=Math.round((ie*.5+.5)*255),Ke[Oe+2]=Math.round(He*255),Ke[Oe+3]=Math.round(qe*255)}(W&127)===127&&(l(.96+.03*W/m,"Tracing water flow..."),await c())}let Me=typeof performance<"u"?performance.now():Date.now();return l(1,"Done"),{heights:U,ao:O,distMain:q,size:m,world:p,waterY:T,bedBase:v,rimY:ke,strata:re,buttes:ee,lakes:I,riverCX:b,flow:{data:Ke,size:m},erosion:{G:te,hardGrid:fe,minH:Q,escale:J},stats:{minH:Q,maxH:j,genMs:Math.round(Me-o),dropCount:H,thermIters:de}}}function Bc(i){let{heights:e,ao:t,distMain:n,size:s,world:r}=i,o=r/2,a=r/(s-1);function l(c,h,u){let f=Zt((h+o)/r*(s-1),0,s-1.001),g=Zt((u+o)/r*(s-1),0,s-1.001),_=Math.floor(f),m=Math.floor(g),p=f-_,d=g-m,M=Math.min(_+1,s-1),v=Math.min(m+1,s-1),T=c[m*s+_],P=c[m*s+M],R=c[v*s+_],A=c[v*s+M];return T+(P-T)*p+(R-T)*d+(T-P-R+A)*p*d}return{cell:a,height:(c,h)=>l(e,c,h),ao:(c,h)=>t?l(t,c,h):1,distRiver:(c,h)=>n?l(n,c,h):1e9,slope:(c,h)=>{let u=a*1.5,f=l(e,c+u,h)-l(e,c-u,h),g=l(e,c,h+u)-l(e,c,h-u);return Math.sqrt(f*f+g*g)/(2*u)}}}function zc(i){let{riverCX:e,size:t,world:n}=i;return s=>{let r=Zt(s/n+.5,0,1)*(t-1),o=Math.floor(r),a=r-o;return Ct(e[o],e[Math.min(t-1,o+1)],a)}}var xo=`
uint cnHash(ivec2 p) {
  uint x = uint(p.x) * 374761393u + uint(p.y) * 668265263u;
  x = (x ^ (x >> 13u)) * 1274126177u;
  return x ^ (x >> 16u);
}
float cnNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = float(cnHash(i)) * 4.6566129e-10;
  float b = float(cnHash(i + ivec2(1, 0))) * 4.6566129e-10;
  float c = float(cnHash(i + ivec2(0, 1))) * 4.6566129e-10;
  float d = float(cnHash(i + ivec2(1, 1))) * 4.6566129e-10;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cnFbm3(vec2 p) {
  return 0.5 * cnNoise(p)
       + 0.3 * cnNoise(p * 2.03 + vec2(11.7, 5.3))
       + 0.2 * cnNoise(p * 4.11 + vec2(7.9, 3.1));
}
float cnHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float cnVNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cnHash12(i);
  float b = cnHash12(i + vec2(1.0, 0.0));
  float c = cnHash12(i + vec2(0.0, 1.0));
  float d = cnHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cnFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * cnVNoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
float cnFbm3b(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * cnVNoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
`;function kc(i,e){let t=new en({color:16777215,roughness:1,metalness:0}),n=i.cols.map(o=>{let a=new Te(o);return new D(a.r,a.g,a.b)}),s=new Te(e.sandColor),r=new Te(e.dustColor);return t.onBeforeCompile=o=>{o.uniforms.uBounds={value:i.bounds.slice()},o.uniforms.uCols={value:n},o.uniforms.uHard={value:i.hard.slice()},o.uniforms.uXbed={value:i.xbed.slice()},o.uniforms.uWaterY={value:e.waterY},o.uniforms.uWarpFreq={value:e.warpFreq},o.uniforms.uWarpAmp={value:e.warpAmp},o.uniforms.uSeedOff={value:new De(e.seedOff[0],e.seedOff[1])},o.uniforms.uSand={value:e.sand},o.uniforms.uStreak={value:e.streak},o.uniforms.uSwirl={value:e.swirl},o.uniforms.uRipple={value:e.ripple},o.uniforms.uSandCol={value:new D(s.r,s.g,s.b)},o.uniforms.uDustCol={value:new D(r.r,r.g,r.b)},o.uniforms.uBumpScale={value:e.bumpScale},o.uniforms.uBumpEps={value:e.bumpEps},o.uniforms.uBumpAmp={value:e.bumpAmp},o.uniforms.uBedFreq={value:e.bedFreq},o.uniforms.uBedAmp={value:e.bedAmp},o.uniforms.uGrooveFreq={value:e.grooveFreq},o.vertexShader=o.vertexShader.replace("#include <common>",`
        #include <common>
        attribute float aAO;
        varying float vAO;
        varying vec3 vWPos;
        varying vec3 vWNormal;
      `).replace("#include <worldpos_vertex>",`
        #include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        vAO = aAO;
      `),o.fragmentShader=o.fragmentShader.replace("#include <common>",`
        #include <common>
        varying float vAO;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform float uBounds[13];
        uniform vec3 uCols[12];
        uniform float uHard[12];
        uniform float uXbed[12];
        uniform float uWaterY;
        uniform float uWarpFreq;
        uniform float uWarpAmp;
        uniform vec2 uSeedOff;
        uniform float uSand;
        uniform float uStreak;
        uniform float uSwirl;
        uniform float uRipple;
        uniform vec3 uSandCol;
        uniform vec3 uDustCol;
        uniform float uBumpScale;
        uniform float uBumpEps;
        uniform float uBumpAmp;
        uniform float uBedFreq;
        uniform float uBedAmp;
        uniform float uGrooveFreq;
        ${xo}
      `).replace("#include <map_fragment>",`
        float gRough = 0.9;
        vec3 cAlbedo = vec3(0.5, 0.5, 0.5);
        {
          vec3 wp = vWPos;
          vec3 wn = normalize(vWNormal);
          float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
          // strata warp (matches CPU hardness field)
          float warpN = cnFbm3(wp.xz * uWarpFreq + uSeedOff);
          float yW = wp.y + (warpN - 0.5) * 2.0 * uWarpAmp;
          // slot-canyon swirl warp
          if (uSwirl > 0.001) {
            float sw = cnFbm(wp.xz * 0.05 + vec2(0.0, wp.y * 0.02));
            float sw2 = cnFbm(wp.xz * 0.05 + vec2(5.2, 1.3) + vec2(0.0, wp.y * 0.02));
            yW += (sw - 0.5) * uSwirl;
            wp.xz += (vec2(sw, sw2) - 0.5) * uSwirl * 0.6;
          }
          // find sedimentary layer (bounds ascending, layer i = [b_i, b_{i+1}])
          int li = 11;
          for (int i = 0; i < 12; i++) {
            if (yW < uBounds[i + 1]) { li = i; break; }
          }
          vec3 base = uCols[li];
          float hard = uHard[li];
          float xb = uXbed[li];
          // triplanar weights
          vec3 abw = pow(abs(wn), vec3(3.0));
          abw /= (abw.x + abw.y + abw.z + 1e-4);
          // grain at two scales, triplanar
          float g1 = cnFbm(wp.yz * 0.33) * abw.x
                   + cnFbm(wp.xz * 0.33) * abw.y
                   + cnFbm(wp.xy * 0.33) * abw.z;
          float g2 = cnFbm(wp.yz * 2.7 + 7.0) * abw.x
                   + cnFbm(wp.xz * 2.7 + 7.0) * abw.y
                   + cnFbm(wp.xy * 2.7 + 7.0) * abw.z;
          vec3 alb = base * (0.82 + 0.36 * g1);
          alb *= 0.92 + 0.16 * g2;
          // bedding planes (thin horizontal lines, weaker in hard rock)
          float bl = pow(0.5 + 0.5 * sin(yW * uBedFreq + warpN * 9.0), 24.0);
          alb *= 1.0 - bl * 0.32 * (1.0 - hard * 0.55);
          // cross-bedding in dune sandstones
          if (xb > 0.5) {
            float ph = (yW + (wp.x + wp.z) * 0.16) * uBedFreq * 0.35;
            float cb = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(ph * 6.28318));
            alb = mix(alb, alb * 0.8 + vec3(0.035, 0.02, 0.01), cb * 0.55);
          }
          float steep = smoothstep(0.42, 0.68, slope);
          // desert varnish: dark vertical streaks on cliffs
          float stn = cnFbm(vec2(wp.z * 0.5, yW * 0.045)) * abw.x
                    + cnFbm(vec2(wp.x * 0.5, yW * 0.045)) * abw.z
                    + cnFbm(vec2((wp.x + wp.z) * 0.35, yW * 0.045)) * abw.y * 0.35;
          float patchy = smoothstep(0.35, 0.65, cnFbm(wp.xz * 0.02 + 3.7));
          float streak = smoothstep(0.52, 0.78, stn) * steep * patchy * uStreak;
          alb = mix(alb, vec3(0.14, 0.09, 0.065), clamp(streak, 0.0, 0.85));
          // sand / gravel cover on gentle slopes
          float sandM = (1.0 - smoothstep(0.22, 0.48, slope)) * uSand;
          vec3 sandC = uSandCol * (0.88 + 0.24 * g2);
          float speck = step(0.935, cnVNoise(wp.xz * 5.0));
          sandC += speck * vec3(0.10, 0.09, 0.07) * (1.0 - steep);
          alb = mix(alb, sandC, clamp(sandM, 0.0, 1.0));
          // large-scale tonal variation (kills banding/tiling)
          alb *= 0.86 + 0.28 * warpN;
          // cavity: darken crevices, dust on up-facing hollows
          alb *= mix(0.5, 1.0, vAO);
          float dust = (1.0 - smoothstep(0.3, 0.75, slope)) * (1.0 - vAO);
          alb = mix(alb, uDustCol, clamp(dust * 0.6, 0.0, 0.6));
          // wet band near the river + pale mineral ring above it
          float wet = 1.0 - smoothstep(uWaterY + 0.3, uWaterY + 2.0, wp.y);
          alb *= 1.0 - wet * 0.45;
          float ring = 1.0 - smoothstep(0.0, 0.9, abs(wp.y - (uWaterY + 2.4)));
          alb += ring * vec3(0.05, 0.05, 0.045) * steep;
          // rainstorm: everything darkens and glosses over when soaked
          alb *= 1.0 - uRainWet * 0.30 * (0.4 + 0.6 * (1.0 - steep));
          // rainstorm: everything darkens and glosses over when soaked
          alb *= 1.0 - uRainWet * 0.30 * (0.4 + 0.6 * (1.0 - steep));
          cAlbedo = alb;
          gRough = mix(0.96, 0.8, steep) + (g2 - 0.5) * 0.1;
          gRough = mix(gRough, 0.22, clamp(wet, 0.0, 1.0));
          gRough = mix(gRough, 0.32, uRainWet * 0.75);
          gRough = mix(gRough, 0.32, uRainWet * 0.75);
        }
        diffuseColor.rgb = cAlbedo;
      `).replace("#include <roughnessmap_fragment>",`
        float roughnessFactor = clamp(gRough, 0.05, 1.0);
      `).replace("#include <normal_fragment_maps>",`
        {
          vec3 Nw0 = inverseTransformDirection(normal, viewMatrix);
          vec3 an = abs(Nw0);
          vec2 P;
          vec3 T;
          vec3 B;
          if (an.y >= an.x && an.y >= an.z) {
            P = vWPos.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0);
          } else if (an.x >= an.z) {
            P = vWPos.zy; T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0);
          } else {
            P = vWPos.xy; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0);
          }
          float be = uBumpEps;
          float bs = uBumpScale;
          float slopeN = 1.0 - clamp(normalize(vWNormal).y, 0.0, 1.0);
          float wallM = smoothstep(0.35, 0.65, slopeN);
          float flatM = 1.0 - smoothstep(0.2, 0.45, slopeN);
          float w2 = cnVNoise(vWPos.xz * uWarpFreq * 4.0 + uSeedOff);
          float bph = vWPos.y * uGrooveFreq + w2 * 10.0;
          float b0 = cnFbm3b(P * bs)
            + pow(0.5 + 0.5 * sin(bph), 6.0) * uBedAmp * wallM;
          float bx = cnFbm3b((P + vec2(be, 0.0)) * bs)
            + pow(0.5 + 0.5 * sin(bph + T.y * be * uGrooveFreq), 6.0) * uBedAmp * wallM;
          float bz = cnFbm3b((P + vec2(0.0, be)) * bs)
            + pow(0.5 + 0.5 * sin(bph + B.y * be * uGrooveFreq), 6.0) * uBedAmp * wallM;
          if (uRipple > 0.001) {
            float rp0 = sin(dot(P, vec2(0.8, 0.6)) * 2.4 + w2 * 6.0);
            float rp1 = sin(dot(P + vec2(be, 0.0), vec2(0.8, 0.6)) * 2.4 + w2 * 6.0);
            float rp2 = sin(dot(P + vec2(0.0, be), vec2(0.8, 0.6)) * 2.4 + w2 * 6.0);
            b0 += rp0 * 0.35 * uRipple * flatM;
            bx += rp1 * 0.35 * uRipple * flatM;
            bz += rp2 * 0.35 * uRipple * flatM;
          }
          vec3 grad = (T * (bx - b0) + B * (bz - b0)) / max(be, 1e-3);
          vec3 Nw2 = normalize(Nw0 - (grad - Nw0 * dot(grad, Nw0)) * uBumpAmp);
          normal = normalize((viewMatrix * vec4(Nw2, 0.0)).xyz);
        }
      `).replace("#include <aomap_fragment>",`
        reflectedLight.indirectDiffuse *= mix(0.35, 1.0, vAO);
      `),t.userData.shader=o},t.customProgramCacheKey=()=>"canyon-terrain-v1",t}function vo(i){let e=new en({color:16777215,transparent:!0,opacity:1,roughness:.15,metalness:0});return e.onBeforeCompile=t=>{t.uniforms.uTime={value:0},t.uniforms.uWaterCol={value:new Te(i.color)},t.uniforms.uShallowCol={value:new Te(i.shallow)},t.uniforms.uSkyTint={value:new Te(i.skyTint)},t.uniforms.uFlowMap={value:i.flowTex},t.uniforms.uWorldSize={value:i.worldSize},t.vertexShader=t.vertexShader.replace("#include <common>",`
        #include <common>
        varying vec3 vWPw;
      `).replace("#include <worldpos_vertex>",`
        #include <worldpos_vertex>
        vWPw = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `),t.fragmentShader=t.fragmentShader.replace("#include <common>",`
        #include <common>
        varying vec3 vWPw;
        uniform float uTime;
        uniform vec3 uWaterCol;
        uniform vec3 uShallowCol;
        uniform vec3 uSkyTint;
        uniform sampler2D uFlowMap;
        uniform float uWorldSize;
        ${xo}
      `).replace("#include <map_fragment>",`
        float wRough = 0.12;
        {
          vec2 fuv = vWPw.xz / uWorldSize + 0.5;
          vec4 flow = texture2D(uFlowMap, fuv);
          vec2 fdir = flow.rg * 2.0 - 1.0;
          float fspeed = flow.b;
          float fdepth = flow.a;
          float alpha = smoothstep(0.015, 0.10, fdepth);
          if (alpha < 0.004) discard;
          vec2 adv = fdir * (uTime * (0.35 + fspeed * 2.4));
          vec2 P = vWPw.xz;
          // depth-graded color
          vec3 wcol = mix(uShallowCol, uWaterCol, smoothstep(0.0, 0.45, fdepth));
          wcol *= 0.9 + 0.2 * cnFbm(P * 0.05 - adv * 0.4);
          // shoreline foam + fast-water streaks
          float foamBand = smoothstep(0.22, 0.0, fdepth);
          float fn = cnFbm(P * 1.4 - adv * 1.3);
          float foam = foamBand * smoothstep(0.42, 0.75, fn);
          vec2 fperp = vec2(-fdir.y, fdir.x);
          float streak = smoothstep(0.55, 0.9, fspeed)
            * smoothstep(0.55, 0.8, cnFbm(vec2(dot(P, fdir) * 0.25 - uTime * 1.4, dot(P, fperp) * 1.1)));
          foam = clamp(foam + streak * 0.7, 0.0, 1.0);
          wcol = mix(wcol, vec3(0.92, 0.94, 0.93), foam * 0.85);
          diffuseColor.rgb = wcol;
          diffuseColor.a = alpha * 0.94;
          wRough = mix(0.10, 0.55, foam);
        }
      `).replace("#include <roughnessmap_fragment>",`
        float roughnessFactor = wRough;
      `).replace("#include <normal_fragment_maps>",`
        {
          vec2 fuv = vWPw.xz / uWorldSize + 0.5;
          vec4 flow = texture2D(uFlowMap, fuv);
          vec2 fdir = flow.rg * 2.0 - 1.0;
          float fspeed = flow.b;
          vec2 adv = fdir * (uTime * (0.35 + fspeed * 2.4));
          vec3 Nw0 = inverseTransformDirection(normal, viewMatrix);
          vec2 P = vWPw.xz;
          float e = 0.6;
          float r0 = cnFbm3b(P * 0.8 - adv) + 0.5 * cnFbm3b(P * 2.3 - adv * 1.7 + 3.1);
          float rx = cnFbm3b((P + vec2(e, 0.0)) * 0.8 - adv) + 0.5 * cnFbm3b((P + vec2(e, 0.0)) * 2.3 - adv * 1.7 + 3.1);
          float rz = cnFbm3b((P + vec2(0.0, e)) * 0.8 - adv) + 0.5 * cnFbm3b((P + vec2(0.0, e)) * 2.3 - adv * 1.7 + 3.1);
          vec3 grad = vec3(rx - r0, 0.0, rz - r0) / max(e, 1e-3);
          vec3 Nw2 = normalize(Nw0 - (grad - Nw0 * dot(grad, Nw0)) * 0.35);
          normal = normalize((viewMatrix * vec4(Nw2, 0.0)).xyz);
        }
      `).replace("#include <emissivemap_fragment>",`
        #include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float fres = pow(1.0 - abs(dot(normalize(normal), Vv)), 3.0);
          totalEmissiveRadiance += uSkyTint * fres * 0.55;
        }
      `),e.userData.shader=t},e.customProgramCacheKey=()=>"canyon-water-v2",e}function Hc(i){let e=new en({color:16777215,transparent:!0,opacity:1,roughness:.1,metalness:0});return e.onBeforeCompile=t=>{t.uniforms.uTime={value:0},t.uniforms.uWaterCol={value:new Te(i.color)},t.uniforms.uShallowCol={value:new Te(i.shallow)},t.uniforms.uSkyTint={value:new Te(i.skyTint)},t.uniforms.uLakeC={value:new De(i.center[0],i.center[1])},t.uniforms.uLakeR={value:i.radius},t.vertexShader=t.vertexShader.replace("#include <common>",`
        #include <common>
        varying vec3 vWPw;
      `).replace("#include <worldpos_vertex>",`
        #include <worldpos_vertex>
        vWPw = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `),t.fragmentShader=t.fragmentShader.replace("#include <common>",`
        #include <common>
        varying vec3 vWPw;
        uniform float uTime;
        uniform vec3 uWaterCol;
        uniform vec3 uShallowCol;
        uniform vec3 uSkyTint;
        uniform vec2 uLakeC;
        uniform float uLakeR;
        ${xo}
      `).replace("#include <map_fragment>",`
        {
          float er = length(vWPw.xz - uLakeC) / uLakeR;
          float alpha = 1.0 - smoothstep(0.72, 0.97, er);
          if (alpha < 0.004) discard;
          vec2 P = vWPw.xz;
          vec2 adv = vec2(uTime * 0.06, uTime * 0.04);
          vec3 wcol = mix(uWaterCol, uShallowCol, smoothstep(0.55, 0.95, er));
          wcol *= 0.93 + 0.14 * cnFbm(P * 0.06 - adv);
          float foam = smoothstep(0.86, 0.985, er) * smoothstep(0.5, 0.8, cnFbm(P * 1.1 - adv * 2.0));
          wcol = mix(wcol, vec3(0.9, 0.92, 0.9), foam * 0.6);
          diffuseColor.rgb = wcol;
          diffuseColor.a = alpha * 0.94;
        }
      `).replace("#include <roughnessmap_fragment>",`
        float roughnessFactor = 0.08;
      `).replace("#include <normal_fragment_maps>",`
        {
          vec3 Nw0 = inverseTransformDirection(normal, viewMatrix);
          vec2 P = vWPw.xz;
          vec2 adv = vec2(uTime * 0.06, uTime * 0.04);
          float e = 0.9;
          float r0 = cnFbm3b(P * 0.5 - adv);
          float rx = cnFbm3b((P + vec2(e, 0.0)) * 0.5 - adv);
          float rz = cnFbm3b((P + vec2(0.0, e)) * 0.5 - adv);
          vec3 grad = vec3(rx - r0, 0.0, rz - r0) / max(e, 1e-3);
          vec3 Nw2 = normalize(Nw0 - (grad - Nw0 * dot(grad, Nw0)) * 0.16);
          normal = normalize((viewMatrix * vec4(Nw2, 0.0)).xyz);
        }
      `).replace("#include <emissivemap_fragment>",`
        #include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float fres = pow(1.0 - abs(dot(normalize(normal), Vv)), 3.0);
          totalEmissiveRadiance += uSkyTint * fres * 0.6;
        }
      `),e.userData.shader=t},e.customProgramCacheKey=()=>"canyon-lake-v1",e}function Vc(i,e,t){let n=new yr(1,e),s=new gs(i),r=n.attributes.position,o=new D;for(let a=0;a<r.count;a++){o.fromBufferAttribute(r,a);let l=s.noise(o.x*1.3+5,(o.y+o.z)*1.3),c=s.noise(o.z*2.7+1,o.y*2.7+3),h=Math.max(.25,1+t*(l*.7+c*.3));r.setXYZ(a,o.x*h,o.y*h,o.z*h)}return n.computeVertexNormals(),n}function Gc(i,e){let t=new jt;if(!e.count)return t;let n=pn(e.seed>>>0),s=[],r=e.count*60;for(;s.length<e.count&&r-- >0;){let u=(n()*2-1)*e.extent,f=(n()*2-1)*e.extent,g=i.height(u,f);if(g<e.waterY+.4)continue;let _=i.slope(u,f);_<.18||_>1.4||i.ao(u,f)>.82&&n()<.7||s.push({x:u,z:f,h:g,s:e.minScale+(e.maxScale-e.minScale)*Math.pow(n(),2.2),ry:n()*Math.PI*2,v:n()})}if(!s.length)return t;let o=new en({color:16777215,roughness:.95,metalness:0,flatShading:!0}),a=new Te(e.color),l=new Te,c=new ht,h=3;for(let u=0;u<h;u++){let f=s.filter((m,p)=>p%h===u);if(!f.length)continue;let g=Vc(pn(e.seed*7+u*101>>>0),2,.45),_=new us(g,o,f.length);f.forEach((m,p)=>{c.position.set(m.x,m.h-m.s*.35,m.z),c.rotation.set(0,m.ry,0),c.scale.set(m.s,m.s*(.7+m.v*.55),m.s*(.8+m.v*.4)),c.updateMatrix(),_.setMatrixAt(p,c.matrix),l.copy(a).offsetHSL((n()-.5)*.02,(n()-.5)*.06,(n()-.5)*.09),_.setColorAt(p,l)}),_.castShadow=!0,_.receiveShadow=!0,_.instanceMatrix.needsUpdate=!0,_.instanceColor&&(_.instanceColor.needsUpdate=!0),t.add(_)}return t}function Wc(i,e,t){let n=[],s=t.world/2;if(t.mode==="switchback"){let u=(t.zFrac-.5)*t.world,f=140,g=7,_=e(u)+t.side*(t.rimHalf+40),m=e(u)+t.side*t.bedHalf*1;for(let p=0;p<=f;p++){let d=p/f,M=Ct(_,m,Math.pow(d,1.15)),v=Math.pow(Math.sin(Math.PI*Math.min(d*1.12,1)),.6),T=u+Math.sin(d*Math.PI*2*g)*t.rimHalf*.1*v,P=i.height(M,T);if(d>.15&&P<t.waterY+1.2)break;n.push({x:M,z:T,h:P})}}else{let u=t.mode==="rim"?t.rimHalf+18:t.bedHalf*3.4,f=160;for(let g=0;g<=f;g++){let _=g/f,m=-s*.9+_*t.world*.9,p=Math.sin(_*21+t.side*3)*7+Math.sin(_*47)*3,d=e(m)+t.side*(u+p);for(let v=0;v<6&&i.height(d,m)<t.waterY+.8;v++)d+=t.side*18;if(Math.abs(d)>s*.96)continue;let M=i.height(d,m);M<t.waterY+.5||n.push({x:d,z:m,h:M})}}if(n.length<4)return null;let r=t.width/2,o=new Float32Array(n.length*2*3),a=[];for(let u=0;u<n.length;u++){let f=n[u],g=n[Math.min(u+1,n.length-1)],_=n[Math.max(u-1,0)],m=g.x-_.x,p=g.z-_.z,d=Math.hypot(m,p)||1;m/=d,p/=d;let M=f.h+.22;if(o[u*6]=f.x-p*r,o[u*6+1]=M,o[u*6+2]=f.z+m*r,o[u*6+3]=f.x+p*r,o[u*6+4]=M,o[u*6+5]=f.z-m*r,u<n.length-1){let v=u*2;a.push(v,v+1,v+2,v+1,v+3,v+2)}}let l=new Ot;l.setAttribute("position",new xt(o,3)),l.setIndex(a),l.computeVertexNormals();let c=new en({color:t.color,roughness:1,metalness:0,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),h=new ot(l,c);return h.receiveShadow=!0,h}function Xc(i,e){let t=new jt;if(!e.count)return t;let n=pn((e.seed^250682)>>>0),s=[],r=e.count*80;for(;s.length<e.count&&r-- >0;){let u=(n()*2-1)*e.extent,f=(n()*2-1)*e.extent,g=i.height(u,f);if(i.slope(u,f)>.5)continue;let m=g>e.waterY+.6&&g<e.waterY+30,p=g>e.rimY-12;if(m){if(n()<.25)continue}else if(p){if(n()<.94)continue}else continue;s.push({x:u,z:f,h:g,s:e.minScale+(e.maxScale-e.minScale)*n(),ry:n()*Math.PI*2,v:n()})}if(!s.length)return t;let o=new en({color:16777215,roughness:1,metalness:0}),a=new Te(e.color),l=new Te,c=new ht,h=2;for(let u=0;u<h;u++){let f=s.filter((m,p)=>p%h===u);if(!f.length)continue;let g=Vc(pn(e.seed*13+u*57>>>0),1,.32),_=new us(g,o,f.length);f.forEach((m,p)=>{c.position.set(m.x,m.h+m.s*.25,m.z),c.rotation.set(0,m.ry,0),c.scale.set(m.s,m.s*.6,m.s),c.updateMatrix(),_.setMatrixAt(p,c.matrix),l.copy(a).offsetHSL((n()-.5)*.03,(n()-.5)*.1,(n()-.5)*.08),_.setColorAt(p,l)}),_.castShadow=!0,_.receiveShadow=!0,_.instanceMatrix.needsUpdate=!0,_.instanceColor&&(_.instanceColor.needsUpdate=!0),t.add(_)}return t}typeof window<"u"&&window.__boot&&window.__boot.marks.push("module-eval");var Jc={grand:{sand:.9,streak:1,swirl:0,ripple:0,sandColor:14270614,dustColor:13350286,bumpScale:.5,bumpEps:.6,bumpAmp:1.35,bedFreq:2.2,bedAmp:.55,grooveFreq:1,rockColor:9396035,bushColor:6449210,waterColor:4683370,shallowColor:8229247,skyTint:12571878,ringColor:13218180,trailColor:13084792},slot:{sand:.5,streak:1.25,swirl:5,ripple:0,sandColor:14391907,dustColor:13208154,bumpScale:1.5,bumpEps:.22,bumpAmp:.9,bedFreq:3.4,bedAmp:.4,grooveFreq:1.7,rockColor:10701357,bushColor:6250806,waterColor:5926490,shallowColor:9079402,skyTint:13621474,ringColor:12618332,trailColor:11893322},wadi:{sand:1,streak:.3,swirl:0,ripple:1,sandColor:14732192,dustColor:14074260,bumpScale:.7,bumpEps:.5,bumpAmp:.9,bedFreq:1.6,bedAmp:.35,grooveFreq:.8,rockColor:11901554,bushColor:7041088,waterColor:7039818,shallowColor:10132082,skyTint:13950440,ringColor:14270868,trailColor:14271128}},Fe={type:"grand",seed:2026,size:512,erosion:1,sun:.35,rocks:!0,bushes:!0,lakes:!0,trails:!0,rain:!1,orbit:!1,strata:"auto",appliedType:null,world:2400},vt,Je,St,tt,$c,Pn,Pt,vs,hn,Wn,kt=null,Gi=null,Wi=null,ci=null,Cn=null,bt=null,gn=null,yo=0,qi=null,Nr=null,So=null,Yi=null,Kc=null,wo=0,Xi=0,jc=0,Xn={sunI:2.5,hemiI:.4,fogNear:1e3,fogFar:8e3},Qe=i=>document.getElementById(i),Pg="b6",Qc=console.error.bind(console);function Fr(i){Qc("[CanyonForge]",i);let e=document.getElementById("errbox"),t=document.getElementById("errtext");e&&t&&(t.textContent+=(t.textContent?`
`:"")+String(i).slice(0,600),e.classList.remove("hidden"))}window.addEventListener("error",i=>Fr(i.message||i.error));window.addEventListener("unhandledrejection",i=>{Fr("Async: "+(i.reason&&i.reason.message||i.reason))});(()=>{let i=0;console.error=(...e)=>{Qc(...e),i<3&&(i++,Fr("Renderer: "+e.map(t=>String(t)).join(" ").slice(0,400)))}})();function Bt(i,e,t){let n=document.getElementById(i);if(!n){console.warn("[CanyonForge] missing #"+i);return}n.addEventListener(e,t)}var qc=()=>new Promise(i=>setTimeout(i,0));function Mo(i,e){Qe("loader").classList.remove("hidden"),Qe("loadbar").style.width=`${Math.round(i*100)}%`,Qe("loadlabel").textContent=e||""}function Lg(){Qe("loader").classList.add("hidden")}function Ur(i){if(!i)return;i.traverse(t=>{t.geometry&&t.geometry.dispose()});let e=new Set;i.traverse(t=>{t.material&&e.add(t.material)}),e.forEach(t=>t.dispose())}function Ig(){let i=Qe("viewport");vt=new cs({antialias:!0,powerPreference:"high-performance"}),vt.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),vt.setSize(i.clientWidth,i.clientHeight),vt.shadowMap.enabled=!0,vt.shadowMap.type=no,vt.toneMapping=io,vt.toneMappingExposure=.55,i.appendChild(vt.domElement),Je=new gr,Je.fog=new mr(13095904,1e3,8e3),St=new Ft(55,i.clientWidth/i.clientHeight,1,3e4),St.position.set(980,560,1180),tt=new Pr(St,vt.domElement),tt.enableDamping=!0,tt.dampingFactor=.06,tt.maxPolarAngle=Math.PI*.495,tt.autoRotateSpeed=.5,tt.enableZoom=!1,Ug(),Pn=new ms,Pn.material.uniforms.turbidity.value=6,Pn.material.uniforms.rayleigh.value=1.2,Pn.material.uniforms.mieCoefficient.value=.006,Pn.material.uniforms.mieDirectionalG.value=.85,Je.add(Pn),Pt=new wr(16777215,2.5),Pt.castShadow=!0,Pt.shadow.mapSize.set(2048,2048),Pt.shadow.bias=-15e-5,Je.add(Pt),Je.add(Pt.target),vs=new Sr(12374248,9072466,.4),Je.add(vs);let e=new hs(new Uint8Array([128,128,0,0]),1,1);e.needsUpdate=!0,hn=new ot(new zi(1,1).rotateX(-Math.PI/2),vo({color:4683370,shallow:8229247,skyTint:12571878,flowTex:e,worldSize:2400})),hn.receiveShadow=!0,hn.renderOrder=2,Je.add(hn),$c=new Er,window.addEventListener("resize",Dg),ih()}function Dg(){let i=Qe("viewport"),e=i.clientWidth,t=i.clientHeight;St.aspect=e/t,St.updateProjectionMatrix(),vt.setSize(e,t)}var ft=null,_s=0,zt=new Set,bo=new D,Yc=new D,Zc=new D(0,1,0),Ir=new D,Dr=new D;function Ug(){vt.domElement.addEventListener("wheel",e=>{e.preventDefault(),ft===null&&(ft=St.position.distanceTo(tt.target));let t=e.deltaMode===1?16:1;ft*=Math.exp(e.deltaY*t*.0011),ft=qt.clamp(ft,tt.minDistance,tt.maxDistance)},{passive:!1});let i=e=>Math.hypot(e[0].clientX-e[1].clientX,e[0].clientY-e[1].clientY);vt.domElement.addEventListener("touchstart",e=>{e.touches.length===2&&(_s=i(e.touches))},{passive:!0}),vt.domElement.addEventListener("touchmove",e=>{if(e.touches.length===2&&_s>0){let t=i(e.touches);ft===null&&(ft=St.position.distanceTo(tt.target)),ft=qt.clamp(ft*(_s/Math.max(t,1)),tt.minDistance,tt.maxDistance),_s=t}},{passive:!0}),vt.domElement.addEventListener("touchend",()=>{_s=0}),window.addEventListener("keydown",e=>{let t=document.activeElement&&document.activeElement.tagName||"";t==="INPUT"||t==="SELECT"||t==="TEXTAREA"||zt.add(e.code)}),window.addEventListener("keyup",e=>zt.delete(e.code)),window.addEventListener("blur",()=>zt.clear()),tt.addEventListener("start",()=>{ft=null})}function Ng(i){if(ft!==null){Dr.copy(St.position).sub(tt.target);let s=Dr.length();if(s>1e-6){let r=1-Math.exp(-i*9),o=qt.lerp(s,ft,r);Dr.setLength(o),St.position.copy(tt.target).add(Dr),Math.abs(o-ft)<Math.max(ft*.001,1e-4)&&(ft=null)}else ft=null}let e=0,t=0,n=0;if((zt.has("KeyW")||zt.has("ArrowUp"))&&(e+=1),(zt.has("KeyS")||zt.has("ArrowDown"))&&(e-=1),(zt.has("KeyD")||zt.has("ArrowRight"))&&(t+=1),(zt.has("KeyA")||zt.has("ArrowLeft"))&&(t-=1),zt.has("KeyE")&&(n+=1),zt.has("KeyQ")&&(n-=1),e!==0||t!==0||n!==0){St.getWorldDirection(bo),Yc.crossVectors(bo,Zc).normalize(),Ir.set(0,0,0).addScaledVector(bo,e).addScaledVector(Yc,t).addScaledVector(Zc,n).normalize();let s=St.position.distanceTo(tt.target),r=Fe.world||2400,o=qt.clamp(s*.9,r*.005,r*.6);(zt.has("ShiftLeft")||zt.has("ShiftRight"))&&(o*=4),Ir.multiplyScalar(o*i),St.position.add(Ir),tt.target.add(Ir),ft=null}}function Eo(){let i=mn[Fe.type],e=Fe.sun,t=qt.degToRad(qt.lerp(9,55,e)),n=qt.degToRad(qt.lerp(118,196,e)),s=new D().setFromSphericalCoords(1,Math.PI/2-t,n);Pn.material.uniforms.sunPosition.value.copy(s),Pt.position.copy(s).multiplyScalar(i.world*1.6),Pt.target.position.set(0,(mn[Fe.type].depth||30)*-.25,0),Pt.color.lerpColors(new Te(16751181),new Te(16774114),Math.min(1,e*1.4)),Pt.intensity=qt.lerp(2.2,3,e),vs.intensity=qt.lerp(.25,.55,e),Je.fog.color.lerpColors(new Te(14398087),new Te(13095904),e),Xn.sunI=Pt.intensity,Xn.hemiI=vs.intensity}function eh(i){Fe.world=i,ft=null,Pn.scale.setScalar(i*6);let e=Pt.shadow.camera;e.left=-i*.5,e.right=i*.5,e.top=i*.5,e.bottom=-i*.5,e.near=i*.4,e.far=i*3.2,Pt.shadow.camera.updateProjectionMatrix(),Pt.shadow.normalBias=i*.001,Pt.shadow.bias=-15e-5,Je.fog.near=i*.6,Je.fog.far=i*3,Xn.fogNear=Je.fog.near,Xn.fogFar=Je.fog.far,St.near=i/2e3,St.far=i*8,St.updateProjectionMatrix(),tt.minDistance=i*.02,tt.maxDistance=i*3}function th(){let i=mn[Fe.type];ft=null,St.position.set(i.camPos[0],i.camPos[1],i.camPos[2]),tt.target.set(i.camTgt[0],i.camTgt[1],i.camTgt[2]),tt.update()}function Fg(i){let{heights:e,ao:t,size:n,world:s}=i,r=new zi(s,s,n-1,n-1);r.rotateX(-Math.PI/2);let o=r.attributes.position,a=new Float32Array(o.count),l=new Int32Array(n*n);for(let c=0;c<o.count;c++){let h=o.getX(c),u=o.getZ(c),f=Math.round((h/s+.5)*(n-1)),_=Math.round((u/s+.5)*(n-1))*n+f;o.setY(c,e[_]),a[c]=t[_],l[_]=c}return r.setAttribute("aAO",new xt(a,1)),r.computeVertexNormals(),r.userData.vmap=l,r}var xs=!1;async function cn(){if(!xs){xs=!0,Qe("generate").disabled=!0;try{Mo(0,"Starting..."),await qc();let{type:i,seed:e,size:t,erosion:n}=Fe,s=mn[i],r=await Oc({type:i,seed:e,size:t,erosion:n,strata:Fe.strata==="auto"?null:Fe.strata,onProgress:Mo});qi=r,Nr=Bc(r),So=zc(r),Mo(.97,"Building meshes..."),await qc(),kt&&(Je.remove(kt),kt.geometry.dispose(),kt.material.dispose());let o=Jc[i],a=kc(r.strata,{waterY:r.waterY,warpFreq:s.warpFreq,warpAmp:s.warpAmp,seedOff:mo(e),sand:o.sand,streak:o.streak,swirl:o.swirl,ripple:o.ripple,sandColor:o.sandColor,dustColor:o.dustColor,bumpScale:o.bumpScale,bumpEps:o.bumpEps,bumpAmp:o.bumpAmp,bedFreq:o.bedFreq,bedAmp:o.bedAmp,grooveFreq:o.grooveFreq});if(kt=new ot(Fg(r),a),kt.castShadow=!0,kt.receiveShadow=!0,Je.add(kt),gn&&(gn.dispose(),gn=null),gn=new hs(r.flow.data,r.flow.size,r.flow.size,Xt),gn.magFilter=Nt,gn.minFilter=Nt,gn.wrapS=Ht,gn.wrapT=Ht,gn.needsUpdate=!0,hn.material.dispose(),hn.material=vo({color:o.waterColor,shallow:o.shallowColor,skyTint:o.skyTint,flowTex:gn,worldSize:r.world}),hn.scale.set(r.world,1,r.world),hn.position.y=r.waterY,Cn&&(Je.remove(Cn),Ur(Cn),Cn=null),Fe.lakes&&r.lakes.length){Cn=new jt;for(let c of r.lakes){let h=new ot(new vr(c.r*.99,48).rotateX(-Math.PI/2),Hc({color:o.waterColor,shallow:o.shallowColor,skyTint:o.skyTint,center:[c.x,c.z],radius:c.r*.99}));h.position.set(c.x,c.waterY,c.z),h.renderOrder=2,Cn.add(h)}Je.add(Cn)}Wn&&(Je.remove(Wn),Wn.geometry.dispose(),Wn.material.dispose()),Wn=new ot(new Mr(r.world*.505,r.world*5,48,1).rotateX(-Math.PI/2),new en({color:o.ringColor,roughness:1,metalness:0})),Wn.position.y=r.rimY-s.plateauAmp-6,Wn.receiveShadow=!0,Je.add(Wn);let l=Nr;if(Gi&&(Je.remove(Gi),Ur(Gi)),Wi&&(Je.remove(Wi),Ur(Wi)),Gi=null,Wi=null,Fe.rocks&&s.rocks&&(Gi=Gc(l,{count:s.rocks,minScale:s.rockMin,maxScale:s.rockMax,waterY:r.waterY,extent:r.world*.49,seed:(e^461845907)>>>0,color:o.rockColor}),Je.add(Gi)),Fe.bushes&&s.bushes){let c=Math.max(s.world/2400,.35);Wi=Xc(l,{count:s.bushes,minScale:1.2*c,maxScale:4.5*c,waterY:r.waterY,rimY:r.rimY,extent:r.world*.49,seed:(e^2246822507)>>>0,color:o.bushColor}),Je.add(Wi)}nh(),Og(r.world),Yi=_o({G:r.erosion.G,hardGrid:r.erosion.hardGrid,distMain:r.distMain,N:r.size,bedHalf:s.bedHalf,lakes:r.lakes}),Kc=pn((e^7447477)>>>0),wo=0,eh(r.world),Eo(),Fe.appliedType!==i&&(Fe.appliedType=i,th()),Hg(r)}catch(i){console.error(i),Qe("loadlabel").textContent="Error: "+i.message,await new Promise(e=>setTimeout(e,2500))}finally{Lg(),xs=!1,Qe("generate").disabled=!1}}}function nh(){if(ci&&(Je.remove(ci),Ur(ci),ci=null),!Fe.trails||!qi||!Nr||!So)return;let i=mn[Fe.type],e=Jc[Fe.type];ci=new jt;let t={rimHalf:i.rimHalf,bedHalf:i.bedHalf,waterY:qi.waterY,world:qi.world,color:e.trailColor},n=Fe.type==="grand"?[{mode:"switchback",side:1,zFrac:.34,width:3},{mode:"rim",side:-1,width:2.5}]:Fe.type==="slot"?[{mode:"rim",side:1,width:1.5}]:[{mode:"riverside",side:-1,width:2.5}];for(let s of n){let r=Wc(Nr,So,{...t,...s});r&&ci.add(r)}Je.add(ci)}function Og(i){bt&&(Je.remove(bt),bt.geometry.dispose(),bt.material.dispose(),bt=null);let e=1500,t=i*.3,n=-i*.2,s=i*.32,r=new Float32Array(e*6),o=new Float32Array(e);for(let l=0;l<e;l++)o[l]=.7+Math.random()*.6,r[l*6]=(Math.random()*2-1)*t,r[l*6+1]=n+Math.random()*(s-n),r[l*6+2]=(Math.random()*2-1)*t,r[l*6+3]=r[l*6],r[l*6+4]=r[l*6+1]+3,r[l*6+5]=r[l*6+2];let a=new Ot;a.setAttribute("position",new xt(r,3)),bt=new xr(a,new ds({color:11191512,transparent:!0,opacity:0})),bt.visible=!1,bt.frustumCulled=!1,bt.userData={count:e,halfBox:t,yMin:n,yMax:s,factors:o,speed:i*.05,wind:i*.008},Je.add(bt)}function Bg(i){let e=bt.userData,t=bt.geometry.attributes.position,n=t.array,s=e.speed*i,r=e.wind*i;for(let o=0;o<e.count;o++){let a=o*6,l=n[a+1]-s*e.factors[o],c=n[a]+r;l<e.yMin&&(l=e.yMax,c=(Math.random()*2-1)*e.halfBox,n[a+2]=(Math.random()*2-1)*e.halfBox),c>e.halfBox&&(c-=e.halfBox*2),n[a]=c,n[a+1]=l,n[a+3]=c-r*2.2,n[a+4]=l+s*e.factors[o]*2.2,n[a+5]=n[a+2]}t.needsUpdate=!0}function zg(){let i=qi;if(!i||!kt||!Yi)return;let{G:e,minH:t,escale:n}=i.erosion,s=i.heights,r=i.size,o=Yi.dirty,a=kt.geometry.attributes.position,l=kt.geometry.attributes.normal,c=kt.geometry.userData.vmap,h=i.world/(r-1),u=0;for(let f=0;f<r;f++){let g=f*r;for(let _=0;_<r;_++){let m=g+_;if(!o[m]||Yi.protection(_,f)>.5)continue;s[m]=t+e[m]*n;let p=c[m];a.setY(p,s[m]);let d=s[g+Math.max(_-1,0)],M=s[g+Math.min(_+1,r-1)],v=s[Math.max(f-1,0)*r+_],T=s[Math.min(f+1,r-1)*r+_],P=-(M-d)/(2*h),R=-(T-v)/(2*h),A=1/Math.hypot(P,1,R);l.setXYZ(p,P*A,A,R*A),u++}}o.fill(0),u&&(a.needsUpdate=!0,l.needsUpdate=!0)}function kg(i){let e=Fe.rain?1:0;Xi+=(e-Xi)*(1-Math.exp(-i*1.2)),Xi<.01&&!Fe.rain&&(Xi=0);let t=Xi;bt&&(bt.visible=t>.02,bt.visible&&(bt.material.opacity=.42*t,Bg(i),bt.position.set(tt.target.x,0,tt.target.z))),Pt.intensity=Xn.sunI*(1-.55*t),vs.intensity=Xn.hemiI+.25*t,Je.fog.near=Xn.fogNear*(1-.45*t),Je.fog.far=Xn.fogFar*(1-.25*t),vt.toneMappingExposure=.55-.12*t,Pn.material.uniforms.turbidity.value=6+5*t;let n=kt&&kt.material.userData.shader;if(n&&n.uniforms.uRainWet&&(n.uniforms.uRainWet.value=t),Yi&&qi&&t>.4&&!xs){let s=Math.round(300*t);Yi.runDroplets(s,Kc,3,!0,null),wo+=s,jc%20===0&&zg()}}function Hg(i){let e=vt.info.render.triangles,t=go(Fe.type,Fe.strata==="auto"?null:Fe.strata),n=Qe("stats");n&&(n.innerHTML=`<span><b>${mn[Fe.type].label}</b> \xB7 ${Lr[t].label} \xB7 seed ${Fe.seed}</span><span>${(e/1e6).toFixed(2)}M tris \xB7 gen ${(i.stats.genMs/1e3).toFixed(1)}s</span>`)}function ih(){requestAnimationFrame(ih);let i=Math.min($c.getDelta(),.1);jc++,typeof window<"u"&&window.__boot&&!window.__boot.firstFrame&&(window.__boot.firstFrame=!0,window.__boot.marks.push("frame1")),yo+=i;let e=hn&&hn.material&&hn.material.userData.shader;e&&(e.uniforms.uTime.value=yo),Cn&&Cn.traverse(t=>{let n=t.material&&t.material.userData.shader;n&&(n.uniforms.uTime.value=yo)}),tt.autoRotate=Fe.orbit,Ng(i),kg(i),tt.update(),vt.render(Je,St)}function Vg(){document.querySelectorAll("#typeSeg button").forEach(i=>{i.addEventListener("click",()=>{document.querySelectorAll("#typeSeg button").forEach(e=>e.classList.remove("active")),i.classList.add("active"),Fe.type=i.dataset.type,cn()})}),Bt("seed","change",()=>{let i=parseInt(Qe("seed").value,10);Fe.seed=Number.isFinite(i)?i:2026}),Bt("dice","click",()=>{Fe.seed=Math.floor(Math.random()*1e5),Qe("seed").value=Fe.seed,cn()}),document.querySelectorAll("#seedChips button").forEach(i=>{i.addEventListener("click",()=>{Fe.seed=parseInt(i.dataset.seed,10),Qe("seed").value=Fe.seed,cn()})}),Bt("strata","change",()=>{Fe.strata=Qe("strata").value,cn()}),Bt("detail","change",()=>{Fe.size=parseInt(Qe("detail").value,10),cn()}),Bt("erosion","input",()=>{Fe.erosion=parseInt(Qe("erosion").value,10)/100,Qe("erosionVal").textContent=`${Qe("erosion").value}%`}),Bt("erosion","change",()=>cn()),Bt("sun","input",()=>{Fe.sun=parseInt(Qe("sun").value,10)/100,Eo()}),Bt("tRocks","change",()=>{Fe.rocks=Qe("tRocks").checked,cn()}),Bt("tBushes","change",()=>{Fe.bushes=Qe("tBushes").checked,cn()}),Bt("tLakes","change",()=>{Fe.lakes=Qe("tLakes").checked,cn()}),Bt("tTrails","change",()=>{Fe.trails=Qe("tTrails").checked,nh()}),Bt("tRain","change",()=>{Fe.rain=Qe("tRain").checked}),Bt("tOrbit","change",()=>{Fe.orbit=Qe("tOrbit").checked}),Bt("generate","click",cn),Bt("collapse","click",()=>{document.body.classList.toggle("panel-hidden")}),setInterval(()=>{if(kt&&!xs){let i=vt.info.render.triangles,e=Qe("stats");if(!e)return;let t=e.querySelectorAll("span")[1];t&&(t.textContent=Xi>.02?`${(i/1e6).toFixed(2)}M tris \xB7 storm +${(wo/1e3).toFixed(1)}k drops`:`${(i/1e6).toFixed(2)}M tris \xB7 seed ${Fe.seed}`)}},1500)}try{let e=["viewport","loader","loadbar","loadlabel","stats","generate"].filter(n=>!document.getElementById(n));if(e.length)throw new Error("Page is stale (missing: "+e.join(", ")+"). Hard-refresh: Ctrl+Shift+R.");console.log("%cCanyon Forge "+Pg+" \xB7 mesh-based heightfield, no SDF","color:#e8a54b"),Ig(),Vg();let t=document.getElementById("jscheck");t&&t.classList.add("hidden"),typeof window<"u"&&window.__boot&&(window.__boot.ok=!0)}catch(i){let e="Boot failed: "+(i&&i.message||i);throw/webgl/i.test(e)&&(e+=" \u2014 WebGL unavailable. Use Chrome/Edge with hardware acceleration enabled."),Fr(e),i}eh(mn[Fe.type].world);Eo();th();cn();
/**
 * @license
 * Copyright 2010-2023 Three.js Authors
 * SPDX-License-Identifier: MIT
 */
//# sourceMappingURL=app-b6.js.map
