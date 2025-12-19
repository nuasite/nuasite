(()=>{var{defineProperty:hw,getOwnPropertyNames:T5,getOwnPropertyDescriptor:f5}=Object,j5=Object.prototype.hasOwnProperty;var h1=new WeakMap,D5=(w)=>{var v=h1.get(w),z;if(v)return v;if(v=hw({},"__esModule",{value:!0}),w&&typeof w==="object"||typeof w==="function")T5(w).map((b)=>!j5.call(v,b)&&hw(v,b,{get:()=>w[b],enumerable:!(z=f5(w,b))||z.enumerable}));return h1.set(w,v),v};var h5=(w,v)=>{for(var z in v)hw(w,z,{get:v[z],enumerable:!0,configurable:!0,set:(b)=>v[z]=()=>b})};var Q6={};h5(Q6,{CmsEditor:()=>f1});var Ww,P,E1,Cw,A0,I1,m1,S1,o1,Ew,Iw,pw,I5,i0={},g1=[],p5=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,xw=Array.isArray;function k0(w,v){for(var z in v)w[z]=v[z];return w}function mw(w){w&&w.parentNode&&w.parentNode.removeChild(w)}function d5(w,v,z){var b,J,Q,Z={};for(Q in v)Q=="key"?b=v[Q]:Q=="ref"?J=v[Q]:Z[Q]=v[Q];if(arguments.length>2&&(Z.children=arguments.length>3?Ww.call(arguments,2):z),typeof w=="function"&&w.defaultProps!=null)for(Q in w.defaultProps)Z[Q]===void 0&&(Z[Q]=w.defaultProps[Q]);return kw(w,Z,b,J,null)}function kw(w,v,z,b,J){var Q={type:w,props:v,key:z,ref:b,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:J==null?++E1:J,__i:-1,__u:0};return J==null&&P.vnode!=null&&P.vnode(Q),Q}function l(w){return w.children}function H0(w,v){this.props=w,this.context=v}function j0(w,v){if(v==null)return w.__?j0(w.__,w.__i+1):null;for(var z;v<w.__k.length;v++)if((z=w.__k[v])!=null&&z.__e!=null)return z.__e;return typeof w.type=="function"?j0(w):null}function c1(w){var v,z;if((w=w.__)!=null&&w.__c!=null){for(w.__e=w.__c.base=null,v=0;v<w.__k.length;v++)if((z=w.__k[v])!=null&&z.__e!=null){w.__e=w.__c.base=z.__e;break}return c1(w)}}function p1(w){(!w.__d&&(w.__d=!0)&&A0.push(w)&&!_w.__r++||I1!=P.debounceRendering)&&((I1=P.debounceRendering)||m1)(_w)}function _w(){for(var w,v,z,b,J,Q,Z,X=1;A0.length;)A0.length>X&&A0.sort(S1),w=A0.shift(),X=A0.length,w.__d&&(z=void 0,b=void 0,J=(b=(v=w).__v).__e,Q=[],Z=[],v.__P&&((z=k0({},b)).__v=b.__v+1,P.vnode&&P.vnode(z),Sw(v.__P,z,b,v.__n,v.__P.namespaceURI,32&b.__u?[J]:null,Q,J==null?j0(b):J,!!(32&b.__u),Z),z.__v=b.__v,z.__.__k[z.__i]=z,i1(Q,z,Z),b.__e=b.__=null,z.__e!=J&&c1(z)));_w.__r=0}function a1(w,v,z,b,J,Q,Z,X,K,$,G){var Y,k,F,x,H,_,O,W=b&&b.__k||g1,A=v.length;for(K=C5(z,v,W,K,A),Y=0;Y<A;Y++)(F=z.__k[Y])!=null&&(k=F.__i==-1?i0:W[F.__i]||i0,F.__i=Y,_=Sw(w,F,k,J,Q,Z,X,K,$,G),x=F.__e,F.ref&&k.ref!=F.ref&&(k.ref&&ow(k.ref,null,F),G.push(F.ref,F.__c||x,F)),H==null&&x!=null&&(H=x),(O=!!(4&F.__u))||k.__k===F.__k?K=u1(F,K,w,O):typeof F.type=="function"&&_!==void 0?K=_:x&&(K=x.nextSibling),F.__u&=-7);return z.__e=H,K}function C5(w,v,z,b,J){var Q,Z,X,K,$,G=z.length,Y=G,k=0;for(w.__k=Array(J),Q=0;Q<J;Q++)(Z=v[Q])!=null&&typeof Z!="boolean"&&typeof Z!="function"?(typeof Z=="string"||typeof Z=="number"||typeof Z=="bigint"||Z.constructor==String?Z=w.__k[Q]=kw(null,Z,null,null,null):xw(Z)?Z=w.__k[Q]=kw(l,{children:Z},null,null,null):Z.constructor==null&&Z.__b>0?Z=w.__k[Q]=kw(Z.type,Z.props,Z.key,Z.ref?Z.ref:null,Z.__v):w.__k[Q]=Z,K=Q+k,Z.__=w,Z.__b=w.__b+1,($=Z.__i=E5(Z,z,K,Y))!=-1&&(Y--,(X=z[$])&&(X.__u|=2)),X==null||X.__v==null?($==-1&&(J>G?k--:J<G&&k++),typeof Z.type!="function"&&(Z.__u|=4)):$!=K&&($==K-1?k--:$==K+1?k++:($>K?k--:k++,Z.__u|=4))):w.__k[Q]=null;if(Y)for(Q=0;Q<G;Q++)(X=z[Q])!=null&&(2&X.__u)==0&&(X.__e==b&&(b=j0(X)),s1(X,X));return b}function u1(w,v,z,b){var J,Q;if(typeof w.type=="function"){for(J=w.__k,Q=0;J&&Q<J.length;Q++)J[Q]&&(J[Q].__=w,v=u1(J[Q],v,z,b));return v}w.__e!=v&&(b&&(v&&w.type&&!v.parentNode&&(v=j0(w)),z.insertBefore(w.__e,v||null)),v=w.__e);do v=v&&v.nextSibling;while(v!=null&&v.nodeType==8);return v}function E5(w,v,z,b){var J,Q,Z,X=w.key,K=w.type,$=v[z],G=$!=null&&(2&$.__u)==0;if($===null&&X==null||G&&X==$.key&&K==$.type)return z;if(b>(G?1:0)){for(J=z-1,Q=z+1;J>=0||Q<v.length;)if(($=v[Z=J>=0?J--:Q++])!=null&&(2&$.__u)==0&&X==$.key&&K==$.type)return Z}return-1}function d1(w,v,z){v[0]=="-"?w.setProperty(v,z==null?"":z):w[v]=z==null?"":typeof z!="number"||p5.test(v)?z:z+"px"}function Fw(w,v,z,b,J){var Q,Z;w:if(v=="style")if(typeof z=="string")w.style.cssText=z;else{if(typeof b=="string"&&(w.style.cssText=b=""),b)for(v in b)z&&v in z||d1(w.style,v,"");if(z)for(v in z)b&&z[v]==b[v]||d1(w.style,v,z[v])}else if(v[0]=="o"&&v[1]=="n")Q=v!=(v=v.replace(o1,"$1")),Z=v.toLowerCase(),v=Z in w||v=="onFocusOut"||v=="onFocusIn"?Z.slice(2):v.slice(2),w.l||(w.l={}),w.l[v+Q]=z,z?b?z.u=b.u:(z.u=Ew,w.addEventListener(v,Q?pw:Iw,Q)):w.removeEventListener(v,Q?pw:Iw,Q);else{if(J=="http://www.w3.org/2000/svg")v=v.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(v!="width"&&v!="height"&&v!="href"&&v!="list"&&v!="form"&&v!="tabIndex"&&v!="download"&&v!="rowSpan"&&v!="colSpan"&&v!="role"&&v!="popover"&&v in w)try{w[v]=z==null?"":z;break w}catch(X){}typeof z=="function"||(z==null||z===!1&&v[4]!="-"?w.removeAttribute(v):w.setAttribute(v,v=="popover"&&z==1?"":z))}}function C1(w){return function(v){if(this.l){var z=this.l[v.type+w];if(v.t==null)v.t=Ew++;else if(v.t<z.u)return;return z(P.event?P.event(v):v)}}}function Sw(w,v,z,b,J,Q,Z,X,K,$){var G,Y,k,F,x,H,_,O,W,A,R,T,U,S,N,p,J0,i=v.type;if(v.constructor!=null)return null;128&z.__u&&(K=!!(32&z.__u),Q=[X=v.__e=z.__e]),(G=P.__b)&&G(v);w:if(typeof i=="function")try{if(O=v.props,W="prototype"in i&&i.prototype.render,A=(G=i.contextType)&&b[G.__c],R=G?A?A.props.value:G.__:b,z.__c?_=(Y=v.__c=z.__c).__=Y.__E:(W?v.__c=Y=new i(O,R):(v.__c=Y=new H0(O,R),Y.constructor=i,Y.render=S5),A&&A.sub(Y),Y.state||(Y.state={}),Y.__n=b,k=Y.__d=!0,Y.__h=[],Y._sb=[]),W&&Y.__s==null&&(Y.__s=Y.state),W&&i.getDerivedStateFromProps!=null&&(Y.__s==Y.state&&(Y.__s=k0({},Y.__s)),k0(Y.__s,i.getDerivedStateFromProps(O,Y.__s))),F=Y.props,x=Y.state,Y.__v=v,k)W&&i.getDerivedStateFromProps==null&&Y.componentWillMount!=null&&Y.componentWillMount(),W&&Y.componentDidMount!=null&&Y.__h.push(Y.componentDidMount);else{if(W&&i.getDerivedStateFromProps==null&&O!==F&&Y.componentWillReceiveProps!=null&&Y.componentWillReceiveProps(O,R),v.__v==z.__v||!Y.__e&&Y.shouldComponentUpdate!=null&&Y.shouldComponentUpdate(O,Y.__s,R)===!1){for(v.__v!=z.__v&&(Y.props=O,Y.state=Y.__s,Y.__d=!1),v.__e=z.__e,v.__k=z.__k,v.__k.some(function(d){d&&(d.__=v)}),T=0;T<Y._sb.length;T++)Y.__h.push(Y._sb[T]);Y._sb=[],Y.__h.length&&Z.push(Y);break w}Y.componentWillUpdate!=null&&Y.componentWillUpdate(O,Y.__s,R),W&&Y.componentDidUpdate!=null&&Y.__h.push(function(){Y.componentDidUpdate(F,x,H)})}if(Y.context=R,Y.props=O,Y.__P=w,Y.__e=!1,U=P.__r,S=0,W){for(Y.state=Y.__s,Y.__d=!1,U&&U(v),G=Y.render(Y.props,Y.state,Y.context),N=0;N<Y._sb.length;N++)Y.__h.push(Y._sb[N]);Y._sb=[]}else do Y.__d=!1,U&&U(v),G=Y.render(Y.props,Y.state,Y.context),Y.state=Y.__s;while(Y.__d&&++S<25);Y.state=Y.__s,Y.getChildContext!=null&&(b=k0(k0({},b),Y.getChildContext())),W&&!k&&Y.getSnapshotBeforeUpdate!=null&&(H=Y.getSnapshotBeforeUpdate(F,x)),p=G,G!=null&&G.type===l&&G.key==null&&(p=l1(G.props.children)),X=a1(w,xw(p)?p:[p],v,z,b,J,Q,Z,X,K,$),Y.base=v.__e,v.__u&=-161,Y.__h.length&&Z.push(Y),_&&(Y.__E=Y.__=null)}catch(d){if(v.__v=null,K||Q!=null)if(d.then){for(v.__u|=K?160:128;X&&X.nodeType==8&&X.nextSibling;)X=X.nextSibling;Q[Q.indexOf(X)]=null,v.__e=X}else{for(J0=Q.length;J0--;)mw(Q[J0]);dw(v)}else v.__e=z.__e,v.__k=z.__k,d.then||dw(v);P.__e(d,v,z)}else Q==null&&v.__v==z.__v?(v.__k=z.__k,v.__e=z.__e):X=v.__e=m5(z.__e,v,z,b,J,Q,Z,K,$);return(G=P.diffed)&&G(v),128&v.__u?void 0:X}function dw(w){w&&w.__c&&(w.__c.__e=!0),w&&w.__k&&w.__k.forEach(dw)}function i1(w,v,z){for(var b=0;b<z.length;b++)ow(z[b],z[++b],z[++b]);P.__c&&P.__c(v,w),w.some(function(J){try{w=J.__h,J.__h=[],w.some(function(Q){Q.call(J)})}catch(Q){P.__e(Q,J.__v)}})}function l1(w){return typeof w!="object"||w==null||w.__b&&w.__b>0?w:xw(w)?w.map(l1):k0({},w)}function m5(w,v,z,b,J,Q,Z,X,K){var $,G,Y,k,F,x,H,_=z.props||i0,O=v.props,W=v.type;if(W=="svg"?J="http://www.w3.org/2000/svg":W=="math"?J="http://www.w3.org/1998/Math/MathML":J||(J="http://www.w3.org/1999/xhtml"),Q!=null){for($=0;$<Q.length;$++)if((F=Q[$])&&"setAttribute"in F==!!W&&(W?F.localName==W:F.nodeType==3)){w=F,Q[$]=null;break}}if(w==null){if(W==null)return document.createTextNode(O);w=document.createElementNS(J,W,O.is&&O),X&&(P.__m&&P.__m(v,Q),X=!1),Q=null}if(W==null)_===O||X&&w.data==O||(w.data=O);else{if(Q=Q&&Ww.call(w.childNodes),!X&&Q!=null)for(_={},$=0;$<w.attributes.length;$++)_[(F=w.attributes[$]).name]=F.value;for($ in _)if(F=_[$],$=="children");else if($=="dangerouslySetInnerHTML")Y=F;else if(!($ in O)){if($=="value"&&"defaultValue"in O||$=="checked"&&"defaultChecked"in O)continue;Fw(w,$,null,F,J)}for($ in O)F=O[$],$=="children"?k=F:$=="dangerouslySetInnerHTML"?G=F:$=="value"?x=F:$=="checked"?H=F:X&&typeof F!="function"||_[$]===F||Fw(w,$,F,_[$],J);if(G)X||Y&&(G.__html==Y.__html||G.__html==w.innerHTML)||(w.innerHTML=G.__html),v.__k=[];else if(Y&&(w.innerHTML=""),a1(v.type=="template"?w.content:w,xw(k)?k:[k],v,z,b,W=="foreignObject"?"http://www.w3.org/1999/xhtml":J,Q,Z,Q?Q[0]:z.__k&&j0(z,0),X,K),Q!=null)for($=Q.length;$--;)mw(Q[$]);X||($="value",W=="progress"&&x==null?w.removeAttribute("value"):x!=null&&(x!==w[$]||W=="progress"&&!x||W=="option"&&x!=_[$])&&Fw(w,$,x,_[$],J),$="checked",H!=null&&H!=w[$]&&Fw(w,$,H,_[$],J))}return w}function ow(w,v,z){try{if(typeof w=="function"){var b=typeof w.__u=="function";b&&w.__u(),b&&v==null||(w.__u=w(v))}else w.current=v}catch(J){P.__e(J,z)}}function s1(w,v,z){var b,J;if(P.unmount&&P.unmount(w),(b=w.ref)&&(b.current&&b.current!=w.__e||ow(b,null,v)),(b=w.__c)!=null){if(b.componentWillUnmount)try{b.componentWillUnmount()}catch(Q){P.__e(Q,v)}b.base=b.__P=null}if(b=w.__k)for(J=0;J<b.length;J++)b[J]&&s1(b[J],v,z||typeof w.type!="function");z||mw(w.__e),w.__c=w.__=w.__e=void 0}function S5(w,v,z){return this.constructor(w,z)}function t1(w,v,z){var b,J,Q,Z;v==document&&(v=document.documentElement),P.__&&P.__(w,v),J=(b=typeof z=="function")?null:z&&z.__k||v.__k,Q=[],Z=[],Sw(v,w=(!b&&z||v).__k=d5(l,null,[w]),J||i0,i0,v.namespaceURI,!b&&z?[z]:J?null:v.firstChild?Ww.call(v.childNodes):null,Q,!b&&z?z:J?J.__e:v.firstChild,b,Z),i1(Q,w,Z)}Ww=g1.slice,P={__e:function(w,v,z,b){for(var J,Q,Z;v=v.__;)if((J=v.__c)&&!J.__)try{if((Q=J.constructor)&&Q.getDerivedStateFromError!=null&&(J.setState(Q.getDerivedStateFromError(w)),Z=J.__d),J.componentDidCatch!=null&&(J.componentDidCatch(w,b||{}),Z=J.__d),Z)return J.__E=J}catch(X){w=X}throw w}},E1=0,Cw=function(w){return w!=null&&w.constructor==null},H0.prototype.setState=function(w,v){var z;z=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=k0({},this.state),typeof w=="function"&&(w=w(k0({},z),this.props)),w&&k0(z,w),w!=null&&this.__v&&(v&&this._sb.push(v),p1(this))},H0.prototype.forceUpdate=function(w){this.__v&&(this.__e=!0,w&&this.__h.push(w),p1(this))},H0.prototype.render=l,A0=[],m1=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,S1=function(w,v){return w.__v.__b-v.__v.__b},_w.__r=0,o1=/(PointerCapture)$|Capture$/i,Ew=0,Iw=C1(!1),pw=C1(!0),I5=0;var l0,E,gw,e1,s0=0,X2=[],m=P,w2=m.__b,v2=m.__r,z2=m.diffed,b2=m.__c,J2=m.unmount,Q2=m.__;function aw(w,v){m.__h&&m.__h(E,w,s0||v),s0=0;var z=E.__H||(E.__H={__:[],__h:[]});return w>=z.__.length&&z.__.push({}),z.__[w]}function f(w){return s0=1,o5(K2,w)}function o5(w,v,z){var b=aw(l0++,2);if(b.t=w,!b.__c&&(b.__=[z?z(v):K2(void 0,v),function(X){var K=b.__N?b.__N[0]:b.__[0],$=b.t(K,X);K!==$&&(b.__N=[$,b.__[1]],b.__c.setState({}))}],b.__c=E,!E.__f)){var J=function(X,K,$){if(!b.__c.__H)return!0;var G=b.__c.__H.__.filter(function(k){return!!k.__c});if(G.every(function(k){return!k.__N}))return!Q||Q.call(this,X,K,$);var Y=b.__c.props!==X;return G.forEach(function(k){if(k.__N){var F=k.__[0];k.__=k.__N,k.__N=void 0,F!==k.__[0]&&(Y=!0)}}),Q&&Q.call(this,X,K,$)||Y};E.__f=!0;var{shouldComponentUpdate:Q,componentWillUpdate:Z}=E;E.componentWillUpdate=function(X,K,$){if(this.__e){var G=Q;Q=void 0,J(X,K,$),Q=G}Z&&Z.call(this,X,K,$)},E.shouldComponentUpdate=J}return b.__N||b.__}function D(w,v){var z=aw(l0++,3);!m.__s&&$2(z.__H,v)&&(z.__=w,z.u=v,E.__H.__h.push(z))}function s(w){return s0=5,D0(function(){return{current:w}},[])}function D0(w,v){var z=aw(l0++,7);return $2(z.__H,v)&&(z.__=w(),z.__H=v,z.__h=w),z.__}function h(w,v){return s0=8,D0(function(){return w},v)}function g5(){for(var w;w=X2.shift();)if(w.__P&&w.__H)try{w.__H.__h.forEach(Hw),w.__H.__h.forEach(cw),w.__H.__h=[]}catch(v){w.__H.__h=[],m.__e(v,w.__v)}}m.__b=function(w){E=null,w2&&w2(w)},m.__=function(w,v){w&&v.__k&&v.__k.__m&&(w.__m=v.__k.__m),Q2&&Q2(w,v)},m.__r=function(w){v2&&v2(w),l0=0;var v=(E=w.__c).__H;v&&(gw===E?(v.__h=[],E.__h=[],v.__.forEach(function(z){z.__N&&(z.__=z.__N),z.u=z.__N=void 0})):(v.__h.forEach(Hw),v.__h.forEach(cw),v.__h=[],l0=0)),gw=E},m.diffed=function(w){z2&&z2(w);var v=w.__c;v&&v.__H&&(v.__H.__h.length&&(X2.push(v)!==1&&e1===m.requestAnimationFrame||((e1=m.requestAnimationFrame)||c5)(g5)),v.__H.__.forEach(function(z){z.u&&(z.__H=z.u),z.u=void 0})),gw=E=null},m.__c=function(w,v){v.some(function(z){try{z.__h.forEach(Hw),z.__h=z.__h.filter(function(b){return!b.__||cw(b)})}catch(b){v.some(function(J){J.__h&&(J.__h=[])}),v=[],m.__e(b,z.__v)}}),b2&&b2(w,v)},m.unmount=function(w){J2&&J2(w);var v,z=w.__c;z&&z.__H&&(z.__H.__.forEach(function(b){try{Hw(b)}catch(J){v=J}}),z.__H=void 0,v&&m.__e(v,z.__v))};var Z2=typeof requestAnimationFrame=="function";function c5(w){var v,z=function(){clearTimeout(b),Z2&&cancelAnimationFrame(v),setTimeout(w)},b=setTimeout(z,35);Z2&&(v=requestAnimationFrame(z))}function Hw(w){var v=E,z=w.__c;typeof z=="function"&&(w.__c=void 0,z()),E=v}function cw(w){var v=E;w.__c=w.__(),E=v}function $2(w,v){return!w||w.length!==v.length||v.some(function(z,b){return z!==w[b]})}function K2(w,v){return typeof v=="function"?v(w):v}var a5=Symbol.for("preact-signals");function yw(){if(!(B0>1)){var w,v=!1;while(t0!==void 0){var z=t0;t0=void 0,uw++;while(z!==void 0){var b=z.o;if(z.o=void 0,z.f&=-3,!(8&z.f)&&q2(z))try{z.c()}catch(J){if(!v)w=J,v=!0}z=b}}if(uw=0,B0--,v)throw w}else B0--}function M0(w){if(B0>0)return w();B0++;try{return w()}finally{yw()}}var j=void 0;function iw(w){var v=j;j=void 0;try{return w()}finally{j=v}}var t0=void 0,B0=0,uw=0,Bw=0;function Y2(w){if(j!==void 0){var v=w.n;if(v===void 0||v.t!==j){if(v={i:0,S:w,p:j.s,n:void 0,t:j,e:void 0,x:void 0,r:v},j.s!==void 0)j.s.n=v;if(j.s=v,w.n=v,32&j.f)w.S(v);return v}else if(v.i===-1){if(v.i=0,v.n!==void 0){if(v.n.p=v.p,v.p!==void 0)v.p.n=v.n;v.p=j.s,v.n=void 0,j.s.n=v,j.s=v}return v}}}function g(w,v){this.v=w,this.i=0,this.n=void 0,this.t=void 0,this.W=v==null?void 0:v.watched,this.Z=v==null?void 0:v.unwatched,this.name=v==null?void 0:v.name}g.prototype.brand=a5;g.prototype.h=function(){return!0};g.prototype.S=function(w){var v=this,z=this.t;if(z!==w&&w.e===void 0)if(w.x=z,this.t=w,z!==void 0)z.e=w;else iw(function(){var b;(b=v.W)==null||b.call(v)})};g.prototype.U=function(w){var v=this;if(this.t!==void 0){var{e:z,x:b}=w;if(z!==void 0)z.x=b,w.e=void 0;if(b!==void 0)b.e=z,w.x=void 0;if(w===this.t){if(this.t=b,b===void 0)iw(function(){var J;(J=v.Z)==null||J.call(v)})}}};g.prototype.subscribe=function(w){var v=this;return R0(function(){var z=v.value,b=j;j=void 0;try{w(z)}finally{j=b}},{name:"sub"})};g.prototype.valueOf=function(){return this.value};g.prototype.toString=function(){return this.value+""};g.prototype.toJSON=function(){return this.value};g.prototype.peek=function(){var w=j;j=void 0;try{return this.value}finally{j=w}};Object.defineProperty(g.prototype,"value",{get:function(){var w=Y2(this);if(w!==void 0)w.i=this.i;return this.v},set:function(w){if(w!==this.v){if(uw>100)throw Error("Cycle detected");this.v=w,this.i++,Bw++,B0++;try{for(var v=this.t;v!==void 0;v=v.x)v.t.N()}finally{yw()}}}});function u(w,v){return new g(w,v)}function q2(w){for(var v=w.s;v!==void 0;v=v.n)if(v.S.i!==v.i||!v.S.h()||v.S.i!==v.i)return!0;return!1}function G2(w){for(var v=w.s;v!==void 0;v=v.n){var z=v.S.n;if(z!==void 0)v.r=z;if(v.S.n=v,v.i=-1,v.n===void 0){w.s=v;break}}}function F2(w){var v=w.s,z=void 0;while(v!==void 0){var b=v.p;if(v.i===-1){if(v.S.U(v),b!==void 0)b.n=v.n;if(v.n!==void 0)v.n.p=b}else z=v;if(v.S.n=v.r,v.r!==void 0)v.r=void 0;v=b}w.s=z}function n0(w,v){g.call(this,void 0),this.x=w,this.s=void 0,this.g=Bw-1,this.f=4,this.W=v==null?void 0:v.watched,this.Z=v==null?void 0:v.unwatched,this.name=v==null?void 0:v.name}n0.prototype=new g;n0.prototype.h=function(){if(this.f&=-3,1&this.f)return!1;if((36&this.f)==32)return!0;if(this.f&=-5,this.g===Bw)return!0;if(this.g=Bw,this.f|=1,this.i>0&&!q2(this))return this.f&=-2,!0;var w=j;try{G2(this),j=this;var v=this.x();if(16&this.f||this.v!==v||this.i===0)this.v=v,this.f&=-17,this.i++}catch(z){this.v=z,this.f|=16,this.i++}return j=w,F2(this),this.f&=-2,!0};n0.prototype.S=function(w){if(this.t===void 0){this.f|=36;for(var v=this.s;v!==void 0;v=v.n)v.S.S(v)}g.prototype.S.call(this,w)};n0.prototype.U=function(w){if(this.t!==void 0){if(g.prototype.U.call(this,w),this.t===void 0){this.f&=-33;for(var v=this.s;v!==void 0;v=v.n)v.S.U(v)}}};n0.prototype.N=function(){if(!(2&this.f)){this.f|=6;for(var w=this.t;w!==void 0;w=w.x)w.t.N()}};Object.defineProperty(n0.prototype,"value",{get:function(){if(1&this.f)throw Error("Cycle detected");var w=Y2(this);if(this.h(),w!==void 0)w.i=this.i;if(16&this.f)throw this.v;return this.v}});function w0(w,v){return new n0(w,v)}function k2(w){var v=w.u;if(w.u=void 0,typeof v=="function"){B0++;var z=j;j=void 0;try{v()}catch(b){throw w.f&=-2,w.f|=8,lw(w),b}finally{j=z,yw()}}}function lw(w){for(var v=w.s;v!==void 0;v=v.n)v.S.U(v);w.x=void 0,w.s=void 0,k2(w)}function u5(w){if(j!==this)throw Error("Out-of-order effect");if(F2(this),j=w,this.f&=-2,8&this.f)lw(this);yw()}function h0(w,v){this.x=w,this.u=void 0,this.s=void 0,this.o=void 0,this.f=32,this.name=v==null?void 0:v.name}h0.prototype.c=function(){var w=this.S();try{if(8&this.f)return;if(this.x===void 0)return;var v=this.x();if(typeof v=="function")this.u=v}finally{w()}};h0.prototype.S=function(){if(1&this.f)throw Error("Cycle detected");this.f|=1,this.f&=-9,k2(this),G2(this),B0++;var w=j;return j=this,u5.bind(this,w)};h0.prototype.N=function(){if(!(2&this.f))this.f|=2,this.o=t0,t0=this};h0.prototype.d=function(){if(this.f|=8,!(1&this.f))lw(this)};h0.prototype.dispose=function(){this.d()};function R0(w,v){var z=new h0(w,v);try{z.c()}catch(J){throw z.d(),J}var b=z.d.bind(z);return b[Symbol.dispose]=b,b}var _2,tw,sw,Ow=typeof window<"u"&&!!window.__PREACT_SIGNALS_DEVTOOLS__;var W2=[];R0(function(){_2=this.N})();function I0(w,v){P[w]=v.bind(null,P[w]||function(){})}function rw(w){if(sw)sw();sw=w&&w.S()}function x2(w){var v=this,z=w.data,b=l5(z);b.value=z;var J=D0(function(){var X=v,K=v.__v;while(K=K.__)if(K.__c){K.__c.__$f|=4;break}var $=w0(function(){var F=b.value.value;return F===0?0:F===!0?"":F||""}),G=w0(function(){return!Array.isArray($.value)&&!Cw($.value)}),Y=R0(function(){if(this.N=H2,G.value){var F=$.value;if(X.__v&&X.__v.__e&&X.__v.__e.nodeType===3)X.__v.__e.data=F}}),k=v.__$u.d;return v.__$u.d=function(){Y(),k.call(this)},[G,$]},[]),Q=J[0],Z=J[1];return Q.value?Z.peek():Z.value}x2.displayName="ReactiveTextNode";Object.defineProperties(g.prototype,{constructor:{configurable:!0,value:void 0},type:{configurable:!0,value:x2},props:{configurable:!0,get:function(){return{data:this}}},__b:{configurable:!0,value:1}});I0("__b",function(w,v){if(Ow&&typeof v.type=="function")window.__PREACT_SIGNALS_DEVTOOLS__.exitComponent();if(typeof v.type=="string"){var z,b=v.props;for(var J in b)if(J!=="children"){var Q=b[J];if(Q instanceof g){if(!z)v.__np=z={};z[J]=Q,b[J]=Q.peek()}}}w(v)});I0("__r",function(w,v){if(Ow&&typeof v.type=="function")window.__PREACT_SIGNALS_DEVTOOLS__.enterComponent(v);if(v.type!==l){rw();var z,b=v.__c;if(b){if(b.__$f&=-2,(z=b.__$u)===void 0)b.__$u=z=function(J){var Q;return R0(function(){Q=this}),Q.c=function(){b.__$f|=1,b.setState({})},Q}()}tw=b,rw(z)}w(v)});I0("__e",function(w,v,z,b){if(Ow)window.__PREACT_SIGNALS_DEVTOOLS__.exitComponent();rw(),tw=void 0,w(v,z,b)});I0("diffed",function(w,v){if(Ow&&typeof v.type=="function")window.__PREACT_SIGNALS_DEVTOOLS__.exitComponent();rw(),tw=void 0;var z;if(typeof v.type=="string"&&(z=v.__e)){var{__np:b,props:J}=v;if(b){var Q=z.U;if(Q)for(var Z in Q){var X=Q[Z];if(X!==void 0&&!(Z in b))X.d(),Q[Z]=void 0}else Q={},z.U=Q;for(var K in b){var $=Q[K],G=b[K];if($===void 0)$=i5(z,K,G,J),Q[K]=$;else $.o(G,J)}}}w(v)});function i5(w,v,z,b){var J=v in w&&w.ownerSVGElement===void 0,Q=u(z);return{o:function(Z,X){Q.value=Z,b=X},d:R0(function(){this.N=H2;var Z=Q.value.value;if(b[v]!==Z)if(b[v]=Z,J)w[v]=Z;else if(Z!=null&&(Z!==!1||v[4]==="-"))w.setAttribute(v,Z);else w.removeAttribute(v)})}}I0("unmount",function(w,v){if(typeof v.type=="string"){var z=v.__e;if(z){var b=z.U;if(b){z.U=void 0;for(var J in b){var Q=b[J];if(Q)Q.d()}}}}else{var Z=v.__c;if(Z){var X=Z.__$u;if(X)Z.__$u=void 0,X.d()}}w(v)});I0("__h",function(w,v,z,b){if(b<3||b===9)v.__$f|=2;w(v,z,b)});H0.prototype.shouldComponentUpdate=function(w,v){var z=this.__$u,b=z&&z.s!==void 0;for(var J in v)return!0;if(this.__f||typeof this.u=="boolean"&&this.u===!0){var Q=2&this.__$f;if(!(b||Q||4&this.__$f))return!0;if(1&this.__$f)return!0}else{if(!(b||4&this.__$f))return!0;if(3&this.__$f)return!0}for(var Z in w)if(Z!=="__source"&&w[Z]!==this.props[Z])return!0;for(var X in this.props)if(!(X in w))return!0;return!1};function l5(w,v){return f(function(){return u(w,v)})[0]}var s5=function(w){queueMicrotask(function(){queueMicrotask(w)})};function t5(){M0(function(){var w;while(w=W2.shift())_2.call(w)})}function H2(){if(W2.push(this)===1)(P.requestAnimationFrame||s5)(t5)}var e5={apiBase:"/_nua/cms",highlightColor:"#005AE0",debug:!1};function Nw(){let w=typeof window<"u"?window.NuaCmsConfig||{}:{};return{...e5,...w}}function w4(){return{isPromptVisible:!1,isProcessing:!1,targetElementId:null,streamingContent:null,error:null,isChatOpen:!1,chatMessages:[],chatContextElementId:null}}function v4(){return{isOpen:!1,currentComponentId:null,mode:"edit"}}var B6=u(!1),v0=u(!1),e0=u(!1),q0=u(null),z4=u(null),t=u(new Map),y6=u(new Map),r6=u(new Map),z0=u({entries:{},components:{},componentDefinitions:{}}),e=u(w4()),d0=w0(()=>e.value.isProcessing),Z0=w0(()=>e.value.isChatOpen),B2=w0(()=>e.value.chatMessages),y2=w0(()=>e.value.chatContextElementId),y0=u(v4()),O6=w0(()=>y0.value.isOpen),N6=w0(()=>y0.value.mode),ew=u(Nw()),p0=u([]),b4=0,w1=w0(()=>{let w=t.value;return Array.from(w.values()).filter((v)=>v.isDirty).length}),r2=w0(()=>{let w=t.value;return Array.from(w.entries()).filter(([v,z])=>z.isDirty)}),L6=w0(()=>w1.value>0);function O2(w){z0.value=w}function v1(w){v0.value=w}function z1(w){e0.value=w}function C0(w){q0.value=w}function b1(w){M0(()=>{z4.value=w,y0.value={...y0.value,currentComponentId:w}})}function N2(w,v){let z=new Map(t.value);z.set(w,v),t.value=z}function J1(w,v){let z=t.value.get(w);if(z){let b=new Map(t.value);b.set(w,v(z)),t.value=b}}function L2(){t.value=new Map}function G0(w){return t.value.get(w)}function _0(w){e.value={...e.value,isProcessing:w}}function Lw(w){e.value={...e.value,isChatOpen:w}}function Uw(w){e.value={...e.value,chatMessages:[...e.value.chatMessages,w]}}function Aw(w,v){e.value={...e.value,chatMessages:e.value.chatMessages.map((z)=>z.id===w?{...z,content:v}:z)}}function ww(w){e.value={...e.value,chatContextElementId:w}}function Q1(w){y0.value={...y0.value,isOpen:w}}function r0(w,v="info"){let z=`toast-${++b4}`;return p0.value=[...p0.value,{id:z,message:w,type:v}],z}function U2(w){p0.value=p0.value.filter((v)=>v.id!==w)}function A2(w){ew.value=w}var J4=0;function q(w,v,z,b,J,Q){v||(v={});var Z,X,K=v;if("ref"in K)for(X in K={},v)X=="ref"?Z=v[X]:K[X]=v[X];var $={type:w,props:K,key:z,ref:Z,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--J4,__i:-1,__u:0,__source:J,__self:Q};if(typeof w=="function"&&(Z=w.defaultProps))for(X in Z)K[X]===void 0&&(K[X]=Z[X]);return P.vnode&&P.vnode($),$}var M2=({callbacks:w})=>{let[v,z]=f(""),[b,J]=f(new Set),Q=s(null),Z=s(null),X=Z0.value,K=B2.value,$=y2.value,G=d0.value;D(()=>{if(Q.current)Q.current.scrollIntoView({behavior:"smooth"})},[K]),D(()=>{if(X&&Z.current&&!G)setTimeout(()=>Z.current?.focus(),50)},[X,G]);let Y=(_)=>{if(_.preventDefault(),v.trim()&&!G){if(w.onSend(v.trim(),$||void 0),z(""),Z.current)Z.current.style.height="auto"}},k=(_)=>{let O=_.target;z(O.value),O.style.height="auto",O.style.height=`${Math.min(O.scrollHeight,120)}px`},F=(_)=>{if(_.key==="Enter"&&!_.shiftKey)_.preventDefault(),Y(_)},x=(_,O,W)=>{w.onApplyToElement(O,W),J(new Set(b).add(_))};if(!X)return null;let H=(_)=>_.stopPropagation();return q("div",{class:"fixed right-5 top-5 bottom-24 w-[400px] max-w-[calc(100vw-40px)] bg-white shadow-brutalist-md border-4 border-black z-2147483645 flex flex-col font-sans overflow-hidden transition-all duration-300","data-cms-ui":!0,onMouseDown:H,onClick:H,children:[q("div",{class:"px-5 py-4 border-b-4 border-black flex items-center justify-between bg-blue-bold",children:[q("div",{class:"flex items-center gap-2.5",children:[q("div",{class:"flex items-center text-white",children:q("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2.5","stroke-linecap":"round","stroke-linejoin":"round",children:q("path",{d:"M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"},void 0,!1,void 0,this)},void 0,!1,void 0,this)},void 0,!1,void 0,this),q("h3",{class:"m-0 text-base font-bold text-white uppercase tracking-wider",children:"AI Assistant"},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("button",{onClick:w.onClose,class:"bg-transparent border-none text-white text-2xl cursor-pointer p-0 leading-none transition-colors w-6 h-6 flex items-center justify-center hover:text-slate-200 font-bold",children:"×"},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-white",children:[K.length===0?q("div",{class:"flex flex-col items-center justify-center h-full text-slate-800 text-center p-10",children:[q("svg",{width:"48",height:"48",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round",class:"mb-4 text-black",children:q("path",{d:"M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q("div",{class:"text-sm font-bold mb-2 text-black uppercase tracking-wide",children:"Start a conversation"},void 0,!1,void 0,this),q("div",{class:"text-xs font-medium text-slate-600",children:"Ask AI to help you edit content"},void 0,!1,void 0,this)]},void 0,!0,void 0,this):K.map((_)=>q("div",{class:"flex flex-col gap-1.5 animate-[slideIn_0.2s_ease]",children:[q("div",{class:`px-4 py-3 text-[13px] leading-relaxed wrap-break-word max-w-[85%] border-2 border-black shadow-brutalist-sm font-medium ${_.role==="user"?"bg-blue-bold text-white self-end":"bg-white text-slate-800 self-start"}`,children:_.content},void 0,!1,void 0,this),_.elementId&&q("div",{class:`text-[10px] text-slate-500 font-mono font-bold px-1 uppercase ${_.role==="user"?"self-end":"self-start"}`,children:["\uD83D\uDCCD ",_.elementId]},void 0,!0,void 0,this),_.role==="assistant"&&_.elementId&&q("button",{onClick:()=>x(_.id,_.content,_.elementId),disabled:b.has(_.id),class:`px-3 py-1.5 border-2 border-black text-[11px] font-bold cursor-pointer self-start transition-all mt-1 shadow-brutalist-sm active:translate-x-px active:translate-y-px active:shadow-none ${b.has(_.id)?"bg-emerald-100 text-emerald-800 cursor-not-allowed opacity-80 shadow-none translate-x-0.5 translate-y-0.5":"bg-white text-slate-800 hover:bg-blue-50"}`,children:b.has(_.id)?"✓ APPLIED":"APPLY TO ELEMENT"},void 0,!1,void 0,this)]},_.id,!0,void 0,this)),q("div",{ref:Q},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"p-4 border-t-4 border-black bg-white",children:[$&&q("div",{class:"px-3 py-2 bg-purple-100 border-2 border-black mb-3 text-[11px] text-purple-900 relative shadow-brutalist-sm",children:[q("button",{onClick:()=>w.onSend("",void 0),class:"absolute top-1 right-2 bg-none border-none text-purple-900 cursor-pointer p-0 text-base leading-none hover:text-purple-700 font-bold",children:"×"},void 0,!1,void 0,this),q("div",{class:"font-bold mb-1 uppercase",children:"Editing:"},void 0,!1,void 0,this),q("div",{class:"font-mono font-bold",children:$},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("form",{onSubmit:Y,class:"flex gap-2",children:[q("textarea",{ref:Z,placeholder:"ASK AI ANYTHING...",rows:1,value:v,onInput:k,onKeyDown:F,disabled:G,class:`flex-1 px-3 py-2.5 border-2 border-black text-[13px] font-sans resize-none max-h-[120px] transition-all outline-none focus:bg-blue-50 shadow-brutalist-sm font-medium placeholder:text-slate-400 ${G?"bg-slate-100 text-slate-400 opacity-60":"bg-white text-slate-800"}`},void 0,!1,void 0,this),q("button",{type:"submit",disabled:G,class:`px-4 border-2 border-black cursor-pointer transition-all flex items-center justify-center shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${G?"bg-slate-200 text-slate-400 cursor-not-allowed":"bg-blue-bold text-white hover:bg-blue-700"}`,children:G?q("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2.5",class:"animate-spin",children:q("path",{d:"M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"},void 0,!1,void 0,this)},void 0,!1,void 0,this):q("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2.5","stroke-linecap":"round","stroke-linejoin":"round",children:[q("line",{x1:"22",y1:"2",x2:"11",y2:"13"},void 0,!1,void 0,this),q("polygon",{points:"22 2 15 22 11 13 2 9 22 2"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)};function n2({callbacks:w,visible:v,elementId:z,rect:b,processing:J}){let[Q,Z]=f(!1),[X,K]=f(""),$=s(null);if(D(()=>{if(!v)Z(!1),K("")},[v]),D(()=>{if(Q&&$.current)setTimeout(()=>$.current?.focus(),50)},[Q]),!v||!b||!z)return null;let G=200,Y=50,k=b.left+b.width/2-G/2,F=b.top-Y-8,x=10,H=window.innerWidth-G-x;if(k=Math.max(x,Math.min(k,H)),F<x)F=b.bottom+8;let O=window.innerHeight-Y-x;F=Math.min(F,O);let W=(U)=>{if(U.preventDefault(),U.stopPropagation(),!Q&&z)Z(!0)},A=(U)=>{U.preventDefault(),U.stopPropagation(),Z(!1)},R=(U)=>{if(U.preventDefault(),U.stopPropagation(),X.trim()&&z)w.onPromptSubmit(X.trim(),z),Z(!1),K("")},T=(U)=>{U.stopPropagation()};return q("div",{"data-cms-ui":!0,onMouseDown:T,onClick:(U)=>U.stopPropagation(),style:{position:"fixed",left:`${k}px`,top:`${F}px`,zIndex:2147483645,fontFamily:"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",fontSize:"12px"},children:q("div",{class:`tooltip ${Q?"expanded":""} ${J?"processing":""} bg-white shadow-brutalist-sm border-2 border-black text-slate-800 font-bold cursor-pointer transition-all duration-200 pointer-events-auto select-none`,onClick:W,onMouseDown:T,style:{padding:Q?"12px":"8px 12px",minWidth:Q?"280px":"auto",maxWidth:Q?"320px":"auto"},children:[!Q&&!J&&q("div",{class:"flex items-center gap-1.5 text-blue-bold",children:[q("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2.5","stroke-linecap":"round","stroke-linejoin":"round",children:q("path",{d:"M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q("span",{class:"uppercase tracking-wide",children:"Ask AI to edit"},void 0,!1,void 0,this)]},void 0,!0,void 0,this),J&&q("div",{class:"flex items-center gap-1.5 text-slate-500",children:[q("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2.5",class:"animate-spin",children:q("path",{d:"M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q("span",{class:"uppercase tracking-wide",children:"Processing..."},void 0,!1,void 0,this)]},void 0,!0,void 0,this),Q&&!J&&q("form",{class:"prompt-form flex flex-col gap-2",onSubmit:R,children:[q("label",{class:"text-[11px] text-slate-500 mb-1 font-bold uppercase",children:"What would you like to change?"},void 0,!1,void 0,this),q("input",{ref:$,type:"text",placeholder:"E.G., MAKE IT SHORTER...",value:X,onInput:(U)=>K(U.target.value),onMouseDown:(U)=>U.stopPropagation(),class:"w-full px-2 py-1.5 border-2 border-black bg-white text-slate-800 text-xs font-sans outline-none focus:bg-blue-50 transition-all shadow-brutalist-sm font-medium"},void 0,!1,void 0,this),q("div",{class:"flex gap-1.5 justify-end mt-1",children:[q("button",{type:"button",onClick:A,onMouseDown:(U)=>U.stopPropagation(),class:"px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-all border-2 border-black bg-white text-slate-800 hover:bg-slate-50 shadow-brutalist-sm active:translate-x-px active:translate-y-px active:shadow-none",children:"CANCEL"},void 0,!1,void 0,this),q("button",{type:"submit",onMouseDown:(U)=>U.stopPropagation(),class:"px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-all border-2 border-black bg-blue-bold text-white hover:bg-blue-700 shadow-brutalist-sm active:translate-x-px active:translate-y-px active:shadow-none",children:"APPLY"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)},void 0,!1,void 0,this)}var R2={HIGHLIGHT:2147483645,OVERLAY:2147483646,MODAL:2147483647,TOAST:2147483648},X0={ELEMENT_DETECTION_THROTTLE_MS:16,BLUR_DELAY_MS:10,TOAST_VISIBLE_DURATION_MS:2200,TOAST_FADE_DURATION_MS:200,PREVIEW_SUCCESS_DURATION_MS:3000,PREVIEW_ERROR_DURATION_MS:5000,FOCUS_DELAY_MS:50},P0={COMPONENT_EDGE_THRESHOLD:32,LABEL_OUTSIDE_THRESHOLD:28,STICKY_PADDING:8,VIEWPORT_PADDING:16,TOOLTIP_WIDTH:200,TOOLTIP_EXPANDED_MIN_WIDTH:280,TOOLTIP_EXPANDED_MAX_WIDTH:320,BLOCK_EDITOR_WIDTH:400,BLOCK_EDITOR_HEIGHT:500,AI_CHAT_WIDTH:400},Mw={REQUEST_TIMEOUT_MS:30000,AI_STREAM_TIMEOUT_MS:120000,MAX_RETRIES:3,RETRY_BASE_DELAY_MS:1000},nw={PENDING_EDITS:"cms-pending-edits"},M={UI_ATTRIBUTE:"data-cms-ui",ID_ATTRIBUTE:"data-cms-id",COMPONENT_ID_ATTRIBUTE:"data-cms-component-id",HIGHLIGHT_ELEMENT:"cms-highlight-overlay"};var Z1=(w,v)=>w.entries[v],P2=(w,v)=>(v in w.entries);var E0=(w,v)=>w.components?.[v],X1=(w)=>w.componentDefinitions??{},Rw=(w,v)=>X1(w)[v],V2=(w)=>Object.keys(w.entries).length;function f2({visible:w,componentId:v,rect:z,onClose:b,onUpdateProps:J,onInsertComponent:Q,onRemoveBlock:Z,onAIFillProps:X}){let[K,$]=f("edit"),[G,Y]=f("after"),[k,F]=f(null),[x,H]=f({}),[_,O]=f(""),[W,A]=f(!1),R=s(null),[T,U]=f({top:0,left:0}),S=X1(z0.value),N=v?E0(z0.value,v):null,p=N?Rw(z0.value,N.componentName):null;D(()=>{if(N)H(N.props||{})},[N]),D(()=>{if(!w)return;let L=()=>{let r=P0.BLOCK_EDITOR_WIDTH,b0=P0.BLOCK_EDITOR_HEIGHT,o=P0.VIEWPORT_PADDING,f0=window.innerWidth,U0=window.innerHeight,I,C;if(z){if(I=z.bottom+o,C=z.left,I+b0>U0-o)I=Math.max(o,z.top-b0-o);if(I<o)I=Math.max(o,(U0-b0)/2);if(C+r>f0-o)C=f0-r-o;if(C<o)C=o}else I=(U0-b0)/2,C=(f0-r)/2;U({top:I,left:C})};return L(),window.addEventListener("resize",L),window.addEventListener("scroll",L),()=>{window.removeEventListener("resize",L),window.removeEventListener("scroll",L)}},[w,z]);let J0=(L,r)=>{H((b0)=>({...b0,[L]:r}))},i=()=>{if(v)J(v,x),b()},d=(L)=>{Y(L),$("insert-picker"),F(null),H({})},$w=(L)=>{let r=S[L];if(!r)return;let b0={};for(let o of r.props)if(o.defaultValue!==void 0)b0[o.name]=o.defaultValue;else if(o.required)b0[o.name]="";F(L),H(b0),$("insert-props")},u0=()=>{if(k&&v)Q(G,v,k,x),b()},x0=()=>{$("edit"),F(null),H(N?.props||{})},Q0=async()=>{if(!v||!_.trim())return;A(!0);try{let L=await X(v,_);H((r)=>({...r,...L})),O("")}finally{A(!1)}};if(!w)return null;return q(l,{children:[q("div",{"data-cms-ui":!0,onClick:b,onMouseDown:(L)=>L.stopPropagation(),class:"fixed inset-0 bg-black/20 backdrop-blur-sm z-2147483646"},void 0,!1,void 0,this),q("div",{ref:R,"data-cms-ui":!0,onMouseDown:(L)=>L.stopPropagation(),onClick:(L)=>L.stopPropagation(),class:"fixed z-2147483647 w-[400px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] bg-white shadow-brutalist-md font-sans text-sm overflow-hidden flex flex-col border-4 border-black",style:{top:`${T.top}px`,left:`${T.left}px`},children:[q("div",{class:"px-4 py-3 border-b-4 border-black flex justify-between items-center bg-blue-bold",children:[q("span",{class:"font-bold text-white uppercase tracking-wider",children:K==="edit"?p?`Edit ${p.name}`:"Block Editor":K==="insert-picker"?`Insert ${G==="before"?"Before":"After"}`:`Add ${k}`},void 0,!1,void 0,this),q("button",{onClick:b,class:"bg-transparent border-none cursor-pointer p-1 text-white hover:text-slate-200 transition-colors font-bold text-lg",children:"✕"},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"p-4 overflow-y-auto flex-1 bg-white",children:K==="edit"&&p?q(l,{children:[q("div",{class:"mb-4 flex gap-2",children:[q("button",{onClick:()=>d("before"),class:"flex-1 py-2.5 px-3 bg-white text-emerald-700 border-2 border-black cursor-pointer text-[13px] font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-50 transition-colors shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",children:[q("span",{class:"text-base",children:"↑"},void 0,!1,void 0,this)," INSERT BEFORE"]},void 0,!0,void 0,this),q("button",{onClick:()=>d("after"),class:"flex-1 py-2.5 px-3 bg-white text-emerald-700 border-2 border-black cursor-pointer text-[13px] font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-50 transition-colors shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",children:[q("span",{class:"text-base",children:"↓"},void 0,!1,void 0,this)," INSERT AFTER"]},void 0,!0,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"mb-4",children:[q("div",{class:"text-xs font-bold text-black tracking-wider mb-2 uppercase border-b-2 border-black pb-1 inline-block",children:"PROPS"},void 0,!1,void 0,this),p.props.map((L)=>q(T2,{prop:L,value:x[L.name]||"",onChange:(r)=>J0(L.name,r)},L.name,!1,void 0,this))]},void 0,!0,void 0,this),q("div",{class:"mb-4",children:[q("div",{class:"text-xs font-bold text-black tracking-wider mb-2 uppercase border-b-2 border-black pb-1 inline-block",children:"AI ASSIST"},void 0,!1,void 0,this),q("div",{class:"flex gap-2",children:[q("input",{type:"text",value:_,onInput:(L)=>O(L.target.value),placeholder:"Describe what you want...",class:"flex-1 px-3 py-2 border-2 border-black text-[13px] outline-none focus:bg-blue-50 transition-all shadow-brutalist-sm"},void 0,!1,void 0,this),q("button",{onClick:Q0,disabled:W||!_.trim(),class:`px-4 py-2 bg-purple-600 text-white border-2 border-black cursor-pointer font-bold transition-all shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${W||!_.trim()?"opacity-50 cursor-not-allowed":"hover:bg-purple-700"}`,children:W?"...":"FILL"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"flex gap-2 justify-between pt-4 border-t-4 border-black mt-4",children:[q("button",{onClick:()=>v&&Z(v),class:"px-4 py-2 bg-rose-600 text-white border-2 border-black cursor-pointer hover:bg-rose-700 transition-colors font-bold shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",children:"REMOVE"},void 0,!1,void 0,this),q("div",{class:"flex gap-2",children:[q("button",{onClick:b,class:"px-4 py-2 bg-white text-slate-800 border-2 border-black cursor-pointer hover:bg-slate-50 transition-colors font-bold shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",children:"CANCEL"},void 0,!1,void 0,this),q("button",{onClick:i,class:"px-4 py-2 bg-blue-bold text-white border-2 border-black cursor-pointer hover:bg-blue-700 transition-all shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none font-bold",children:"SAVE"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this):K==="insert-props"&&k?q(l,{children:[q("div",{class:"mb-4",children:[q("div",{class:"px-3 py-2 bg-emerald-100 border-2 border-black mb-3 text-[13px] text-emerald-900 font-medium shadow-brutalist-sm",children:["Inserting ",q("strong",{children:k},void 0,!1,void 0,this)," ",G," current component"]},void 0,!0,void 0,this),S[k]?.props.map((L)=>q(T2,{prop:L,value:x[L.name]||"",onChange:(r)=>J0(L.name,r)},L.name,!1,void 0,this))]},void 0,!0,void 0,this),q("div",{class:"flex gap-2 justify-end pt-4 border-t-4 border-black mt-4",children:[q("button",{onClick:()=>$("insert-picker"),class:"px-4 py-2 bg-white text-slate-800 border-2 border-black cursor-pointer hover:bg-slate-50 transition-colors font-bold shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",children:"← BACK"},void 0,!1,void 0,this),q("button",{onClick:u0,class:"px-4 py-2 bg-emerald-600 text-white border-2 border-black cursor-pointer hover:bg-emerald-700 transition-all shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none font-bold",children:"INSERT COMPONENT"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this):K==="insert-picker"?q("div",{children:[q("div",{class:"text-xs font-bold text-black tracking-wider mb-3 uppercase border-b-2 border-black pb-1 inline-block",children:"SELECT COMPONENT TO INSERT"},void 0,!1,void 0,this),q("div",{class:"flex flex-col gap-2",children:Object.values(S).map((L)=>q("button",{onClick:()=>$w(L.name),class:"p-3 bg-white border-2 border-black cursor-pointer text-left transition-all hover:bg-blue-50 shadow-brutalist-sm active:translate-x-px active:translate-y-px active:shadow-none group",children:[q("div",{class:"font-bold text-slate-800 group-hover:text-blue-bold",children:L.name},void 0,!1,void 0,this),L.description&&q("div",{class:"text-xs text-slate-600 mt-1 font-medium",children:L.description},void 0,!1,void 0,this),q("div",{class:"text-[11px] text-slate-500 mt-1 font-mono font-bold",children:[L.props.length," props",L.slots&&L.slots.length>0&&` • ${L.slots.length} slots`]},void 0,!0,void 0,this)]},L.name,!0,void 0,this))},void 0,!1,void 0,this),q("div",{class:"mt-4 pt-4 border-t-4 border-black",children:q("button",{onClick:x0,class:"w-full px-4 py-2 bg-white text-slate-800 border-2 border-black cursor-pointer hover:bg-slate-50 transition-colors font-bold shadow-brutalist-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",children:"← BACK TO EDIT"},void 0,!1,void 0,this)},void 0,!1,void 0,this)]},void 0,!0,void 0,this):q("div",{class:"text-center text-slate-500 py-8 font-bold",children:q("p",{children:"Select a component to edit its properties."},void 0,!1,void 0,this)},void 0,!1,void 0,this)},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)}function T2({prop:w,value:v,onChange:z}){let b=w.type==="boolean",J=w.type==="number";return q("div",{class:"mb-3",children:[q("label",{class:"block text-[13px] font-bold text-slate-800 mb-1 uppercase",children:[w.name,w.required&&q("span",{class:"text-rose-600 ml-1",children:"*"},void 0,!1,void 0,this)]},void 0,!0,void 0,this),w.description&&q("div",{class:"text-[11px] text-slate-500 mb-1 font-medium",children:w.description},void 0,!1,void 0,this),b?q("label",{class:"flex items-center gap-2 cursor-pointer",children:[q("input",{type:"checkbox",checked:v==="true",onChange:(Q)=>z(Q.target.checked?"true":"false"),class:"accent-blue-bold w-5 h-5 border-2 border-black"},void 0,!1,void 0,this),q("span",{class:"text-[13px] text-slate-800 font-bold",children:v==="true"?"ENABLED":"DISABLED"},void 0,!1,void 0,this)]},void 0,!0,void 0,this):q("input",{type:J?"number":"text",value:v,onInput:(Q)=>z(Q.target.value),placeholder:w.defaultValue||`Enter ${w.name}...`,class:"w-full px-3 py-2 border-2 border-black text-[13px] outline-none focus:bg-blue-50 transition-all shadow-brutalist-sm font-medium"},void 0,!1,void 0,this),q("div",{class:"text-[10px] text-slate-400 mt-1 font-mono font-bold",children:["TYPE: ",w.type.toUpperCase()]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)}class O0 extends H0{constructor(w){super(w);this.state={hasError:!1,error:null}}static getDerivedStateFromError(w){return{hasError:!0,error:w}}componentDidCatch(w,v){console.error("[CMS] Component error:",w),console.error("[CMS] Component stack:",v.componentStack),this.props.onError?.(w,v)}handleRetry=()=>{this.setState({hasError:!1,error:null})};render(){if(this.state.hasError){if(this.props.fallback)return this.props.fallback;let w=this.props.componentName||"Component";return q("div",{"data-cms-ui":!0,class:"p-4 bg-red-50 border-2 border-red-500 text-red-800 font-sans text-sm",style:{fontFamily:"system-ui, -apple-system, sans-serif"},children:[q("div",{class:"font-bold mb-2 flex items-center gap-2",children:[q("span",{class:"text-red-600",children:"⚠"},void 0,!1,void 0,this),w," Error"]},void 0,!0,void 0,this),q("div",{class:"text-xs text-red-600 mb-3 font-mono",children:this.state.error?.message||"An unexpected error occurred"},void 0,!1,void 0,this),q("button",{onClick:this.handleRetry,class:"px-3 py-1.5 bg-red-600 text-white border-2 border-red-800 text-xs font-bold cursor-pointer hover:bg-red-700 transition-colors",children:"Retry"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)}return this.props.children}}var vw=8;function j2({visible:w,rect:v,isComponent:z=!1,componentName:b,tagName:J,element:Q}){let Z=s(null),X=s(null),K=s(null),$=s(null);return D(()=>{if(Z.current&&!X.current){X.current=Z.current.attachShadow({mode:"open"});let G=document.createElement("style");G.textContent=`
        :host {
          position: fixed;
          top: 0;
          left: 0;
          pointer-events: none;
          z-index: 2147483646;
        }

        .outline-overlay {
          position: fixed;
          border-radius: 0;
          box-sizing: border-box;
          transition: opacity 100ms ease;
          overflow: visible;
        }

        .outline-overlay.hidden {
          opacity: 0;
        }

        .outline-overlay.visible {
          opacity: 1;
        }

        .outline-label {
          position: fixed;
          padding: 4px 10px;
          border-radius: 0;
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 4px 4px 0px 0px #000000;
          border: 2px solid black;
          z-index: 2147483647;
        }

        .outline-label .tag {
          opacity: 0.9;
        }

        .outline-label .component-name {
          font-weight: 800;
        }

        .outline-label .separator {
          opacity: 0.5;
        }
      `,K.current=document.createElement("div"),K.current.className="outline-overlay hidden",$.current=document.createElement("div"),$.current.className="outline-label",X.current.appendChild(G),X.current.appendChild(K.current),X.current.appendChild($.current)}},[]),D(()=>{if(!K.current||!$.current)return;if(!w||!v){K.current.className="outline-overlay hidden",$.current.style.display="none";return}K.current.className="outline-overlay visible";let{innerHeight:G,innerWidth:Y}=window,k=v.left-2,F=v.top-2,x=v.width+4,H=v.height+4;if(K.current.style.left=`${k}px`,K.current.style.top=`${F}px`,K.current.style.width=`${x}px`,K.current.style.height=`${H}px`,z){K.current.style.border="4px solid black",K.current.style.backgroundColor="rgba(0, 90, 224, 0.1)",K.current.style.boxShadow="4px 4px 0px 0px rgba(0,0,0,0.2)",$.current.style.display="flex",$.current.style.backgroundColor="#005AE0",$.current.style.color="white";let _="";if(J)_+=`<span class="tag">&lt;${J}&gt;</span>`;if(b){if(J)_+='<span class="separator">·</span>';_+=`<span class="component-name">${b}</span>`}if(!J&&!b)_="COMPONENT";$.current.innerHTML=_;let{top:O,bottom:W,left:A}=v,R=O-36,T=Math.max(vw,A);if(O<vw+36)R=Math.max(vw,Math.min(O+vw,W-36));if(O>G)$.current.style.display="none";else if(W<0)$.current.style.display="none";else R=Math.max(vw,Math.min(R,G-36)),T=Math.min(T,Y-150),$.current.style.top=`${R}px`,$.current.style.left=`${T}px`}else K.current.style.border="2px dashed black",K.current.style.backgroundColor="transparent",K.current.style.boxShadow="none",$.current.style.display="none"},[w,v,z,b,J]),q("div",{ref:Z,style:{position:"fixed",top:0,left:0,width:0,height:0,pointerEvents:"none",zIndex:2147483646}},void 0,!1,void 0,this)}function D2(w){var v,z,b="";if(typeof w=="string"||typeof w=="number")b+=w;else if(typeof w=="object")if(Array.isArray(w)){var J=w.length;for(v=0;v<J;v++)w[v]&&(z=D2(w[v]))&&(b&&(b+=" "),b+=z)}else for(z in w)w[z]&&(b&&(b+=" "),b+=z);return b}function h2(){for(var w,v,z=0,b="",J=arguments.length;z<J;z++)(w=arguments[z])&&(v=D2(w))&&(b&&(b+=" "),b+=v);return b}var Q4=(w,v)=>{let z=Array(w.length+v.length);for(let b=0;b<w.length;b++)z[b]=w[b];for(let b=0;b<v.length;b++)z[w.length+b]=v[b];return z},Z4=(w,v)=>({classGroupId:w,validator:v}),E2=(w=new Map,v=null,z)=>({nextPart:w,validators:v,classGroupId:z});var I2=[];var X4=(w)=>{let v=K4(w),{conflictingClassGroups:z,conflictingClassGroupModifiers:b}=w;return{getClassGroupId:(Z)=>{if(Z.startsWith("[")&&Z.endsWith("]"))return $4(Z);let X=Z.split("-"),K=X[0]===""&&X.length>1?1:0;return m2(X,K,v)},getConflictingClassGroupIds:(Z,X)=>{if(X){let K=b[Z],$=z[Z];if(K){if($)return Q4($,K);return K}return $||I2}return z[Z]||I2}}},m2=(w,v,z)=>{if(w.length-v===0)return z.classGroupId;let J=w[v],Q=z.nextPart.get(J);if(Q){let $=m2(w,v+1,Q);if($)return $}let Z=z.validators;if(Z===null)return;let X=v===0?w.join("-"):w.slice(v).join("-"),K=Z.length;for(let $=0;$<K;$++){let G=Z[$];if(G.validator(X))return G.classGroupId}return},$4=(w)=>w.slice(1,-1).indexOf(":")===-1?void 0:(()=>{let v=w.slice(1,-1),z=v.indexOf(":"),b=v.slice(0,z);return b?"arbitrary.."+b:void 0})(),K4=(w)=>{let{theme:v,classGroups:z}=w;return Y4(z,v)},Y4=(w,v)=>{let z=E2();for(let b in w){let J=w[b];Y1(J,z,b,v)}return z},Y1=(w,v,z,b)=>{let J=w.length;for(let Q=0;Q<J;Q++){let Z=w[Q];q4(Z,v,z,b)}},q4=(w,v,z,b)=>{if(typeof w==="string"){G4(w,v,z);return}if(typeof w==="function"){F4(w,v,z,b);return}k4(w,v,z,b)},G4=(w,v,z)=>{let b=w===""?v:S2(v,w);b.classGroupId=z},F4=(w,v,z,b)=>{if(_4(w)){Y1(w(b),v,z,b);return}if(v.validators===null)v.validators=[];v.validators.push(Z4(z,w))},k4=(w,v,z,b)=>{let J=Object.entries(w),Q=J.length;for(let Z=0;Z<Q;Z++){let[X,K]=J[Z];Y1(K,S2(v,X),z,b)}},S2=(w,v)=>{let z=w,b=v.split("-"),J=b.length;for(let Q=0;Q<J;Q++){let Z=b[Q],X=z.nextPart.get(Z);if(!X)X=E2(),z.nextPart.set(Z,X);z=X}return z},_4=(w)=>("isThemeGetter"in w)&&w.isThemeGetter===!0,W4=(w)=>{if(w<1)return{get:()=>{return},set:()=>{}};let v=0,z=Object.create(null),b=Object.create(null),J=(Q,Z)=>{if(z[Q]=Z,v++,v>w)v=0,b=z,z=Object.create(null)};return{get(Q){let Z=z[Q];if(Z!==void 0)return Z;if((Z=b[Q])!==void 0)return J(Q,Z),Z},set(Q,Z){if(Q in z)z[Q]=Z;else J(Q,Z)}}};var x4=[],p2=(w,v,z,b,J)=>({modifiers:w,hasImportantModifier:v,baseClassName:z,maybePostfixModifierPosition:b,isExternal:J}),H4=(w)=>{let{prefix:v,experimentalParseClassName:z}=w,b=(J)=>{let Q=[],Z=0,X=0,K=0,$,G=J.length;for(let H=0;H<G;H++){let _=J[H];if(Z===0&&X===0){if(_===":"){Q.push(J.slice(K,H)),K=H+1;continue}if(_==="/"){$=H;continue}}if(_==="[")Z++;else if(_==="]")Z--;else if(_==="(")X++;else if(_===")")X--}let Y=Q.length===0?J:J.slice(K),k=Y,F=!1;if(Y.endsWith("!"))k=Y.slice(0,-1),F=!0;else if(Y.startsWith("!"))k=Y.slice(1),F=!0;let x=$&&$>K?$-K:void 0;return p2(Q,F,k,x)};if(v){let J=v+":",Q=b;b=(Z)=>Z.startsWith(J)?Q(Z.slice(J.length)):p2(x4,!1,Z,void 0,!0)}if(z){let J=b;b=(Q)=>z({className:Q,parseClassName:J})}return b},B4=(w)=>{let v=new Map;return w.orderSensitiveModifiers.forEach((z,b)=>{v.set(z,1e6+b)}),(z)=>{let b=[],J=[];for(let Q=0;Q<z.length;Q++){let Z=z[Q],X=Z[0]==="[",K=v.has(Z);if(X||K){if(J.length>0)J.sort(),b.push(...J),J=[];b.push(Z)}else J.push(Z)}if(J.length>0)J.sort(),b.push(...J);return b}},y4=(w)=>({cache:W4(w.cacheSize),parseClassName:H4(w),sortModifiers:B4(w),...X4(w)}),r4=/\s+/,O4=(w,v)=>{let{parseClassName:z,getClassGroupId:b,getConflictingClassGroupIds:J,sortModifiers:Q}=v,Z=[],X=w.trim().split(r4),K="";for(let $=X.length-1;$>=0;$-=1){let G=X[$],{isExternal:Y,modifiers:k,hasImportantModifier:F,baseClassName:x,maybePostfixModifierPosition:H}=z(G);if(Y){K=G+(K.length>0?" "+K:K);continue}let _=!!H,O=b(_?x.substring(0,H):x);if(!O){if(!_){K=G+(K.length>0?" "+K:K);continue}if(O=b(x),!O){K=G+(K.length>0?" "+K:K);continue}_=!1}let W=k.length===0?"":k.length===1?k[0]:Q(k).join(":"),A=F?W+"!":W,R=A+O;if(Z.indexOf(R)>-1)continue;Z.push(R);let T=J(O,_);for(let U=0;U<T.length;++U){let S=T[U];Z.push(A+S)}K=G+(K.length>0?" "+K:K)}return K},N4=(...w)=>{let v=0,z,b,J="";while(v<w.length)if(z=w[v++]){if(b=o2(z))J&&(J+=" "),J+=b}return J},o2=(w)=>{if(typeof w==="string")return w;let v,z="";for(let b=0;b<w.length;b++)if(w[b]){if(v=o2(w[b]))z&&(z+=" "),z+=v}return z},L4=(w,...v)=>{let z,b,J,Q,Z=(K)=>{let $=v.reduce((G,Y)=>Y(G),w());return z=y4($),b=z.cache.get,J=z.cache.set,Q=X,X(K)},X=(K)=>{let $=b(K);if($)return $;let G=O4(K,z);return J(K,G),G};return Q=Z,(...K)=>Q(N4(...K))},U4=[],c=(w)=>{let v=(z)=>z[w]||U4;return v.isThemeGetter=!0,v},g2=/^\[(?:(\w[\w-]*):)?(.+)\]$/i,c2=/^\((?:(\w[\w-]*):)?(.+)\)$/i,A4=/^\d+\/\d+$/,M4=/^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,n4=/\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,R4=/^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,P4=/^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,V4=/^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,m0=(w)=>A4.test(w),n=(w)=>!!w&&!Number.isNaN(Number(w)),N0=(w)=>!!w&&Number.isInteger(Number(w)),$1=(w)=>w.endsWith("%")&&n(w.slice(0,-1)),W0=(w)=>M4.test(w),T4=()=>!0,f4=(w)=>n4.test(w)&&!R4.test(w),a2=()=>!1,j4=(w)=>P4.test(w),D4=(w)=>V4.test(w),h4=(w)=>!B(w)&&!y(w),I4=(w)=>S0(w,l2,a2),B=(w)=>g2.test(w),V0=(w)=>S0(w,s2,f4),K1=(w)=>S0(w,m4,n),d2=(w)=>S0(w,u2,a2),p4=(w)=>S0(w,i2,D4),Pw=(w)=>S0(w,t2,j4),y=(w)=>c2.test(w),zw=(w)=>o0(w,s2),d4=(w)=>o0(w,S4),C2=(w)=>o0(w,u2),C4=(w)=>o0(w,l2),E4=(w)=>o0(w,i2),Vw=(w)=>o0(w,t2,!0),S0=(w,v,z)=>{let b=g2.exec(w);if(b){if(b[1])return v(b[1]);return z(b[2])}return!1},o0=(w,v,z=!1)=>{let b=c2.exec(w);if(b){if(b[1])return v(b[1]);return z}return!1},u2=(w)=>w==="position"||w==="percentage",i2=(w)=>w==="image"||w==="url",l2=(w)=>w==="length"||w==="size"||w==="bg-size",s2=(w)=>w==="length",m4=(w)=>w==="number",S4=(w)=>w==="family-name",t2=(w)=>w==="shadow";var o4=()=>{let w=c("color"),v=c("font"),z=c("text"),b=c("font-weight"),J=c("tracking"),Q=c("leading"),Z=c("breakpoint"),X=c("container"),K=c("spacing"),$=c("radius"),G=c("shadow"),Y=c("inset-shadow"),k=c("text-shadow"),F=c("drop-shadow"),x=c("blur"),H=c("perspective"),_=c("aspect"),O=c("ease"),W=c("animate"),A=()=>["auto","avoid","all","avoid-page","page","left","right","column"],R=()=>["center","top","bottom","left","right","top-left","left-top","top-right","right-top","bottom-right","right-bottom","bottom-left","left-bottom"],T=()=>[...R(),y,B],U=()=>["auto","hidden","clip","visible","scroll"],S=()=>["auto","contain","none"],N=()=>[y,B,K],p=()=>[m0,"full","auto",...N()],J0=()=>[N0,"none","subgrid",y,B],i=()=>["auto",{span:["full",N0,y,B]},N0,y,B],d=()=>[N0,"auto",y,B],$w=()=>["auto","min","max","fr",y,B],u0=()=>["start","end","center","between","around","evenly","stretch","baseline","center-safe","end-safe"],x0=()=>["start","end","center","stretch","center-safe","end-safe"],Q0=()=>["auto",...N()],L=()=>[m0,"auto","full","dvw","dvh","lvw","lvh","svw","svh","min","max","fit",...N()],r=()=>[w,y,B],b0=()=>[...R(),C2,d2,{position:[y,B]}],o=()=>["no-repeat",{repeat:["","x","y","space","round"]}],f0=()=>["auto","cover","contain",C4,I4,{size:[y,B]}],U0=()=>[$1,zw,V0],I=()=>["","none","full",$,y,B],C=()=>["",n,zw,V0],Kw=()=>["solid","dashed","dotted","double"],j1=()=>["normal","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"],a=()=>[n,$1,C2,d2],D1=()=>["","none",x,y,B],Yw=()=>["none",n,y,B],qw=()=>["none",n,y,B],Dw=()=>[n,y,B],Gw=()=>[m0,"full",...N()];return{cacheSize:500,theme:{animate:["spin","ping","pulse","bounce"],aspect:["video"],blur:[W0],breakpoint:[W0],color:[T4],container:[W0],"drop-shadow":[W0],ease:["in","out","in-out"],font:[h4],"font-weight":["thin","extralight","light","normal","medium","semibold","bold","extrabold","black"],"inset-shadow":[W0],leading:["none","tight","snug","normal","relaxed","loose"],perspective:["dramatic","near","normal","midrange","distant","none"],radius:[W0],shadow:[W0],spacing:["px",n],text:[W0],"text-shadow":[W0],tracking:["tighter","tight","normal","wide","wider","widest"]},classGroups:{aspect:[{aspect:["auto","square",m0,B,y,_]}],container:["container"],columns:[{columns:[n,B,y,X]}],"break-after":[{"break-after":A()}],"break-before":[{"break-before":A()}],"break-inside":[{"break-inside":["auto","avoid","avoid-page","avoid-column"]}],"box-decoration":[{"box-decoration":["slice","clone"]}],box:[{box:["border","content"]}],display:["block","inline-block","inline","flex","inline-flex","table","inline-table","table-caption","table-cell","table-column","table-column-group","table-footer-group","table-header-group","table-row-group","table-row","flow-root","grid","inline-grid","contents","list-item","hidden"],sr:["sr-only","not-sr-only"],float:[{float:["right","left","none","start","end"]}],clear:[{clear:["left","right","both","none","start","end"]}],isolation:["isolate","isolation-auto"],"object-fit":[{object:["contain","cover","fill","none","scale-down"]}],"object-position":[{object:T()}],overflow:[{overflow:U()}],"overflow-x":[{"overflow-x":U()}],"overflow-y":[{"overflow-y":U()}],overscroll:[{overscroll:S()}],"overscroll-x":[{"overscroll-x":S()}],"overscroll-y":[{"overscroll-y":S()}],position:["static","fixed","absolute","relative","sticky"],inset:[{inset:p()}],"inset-x":[{"inset-x":p()}],"inset-y":[{"inset-y":p()}],start:[{start:p()}],end:[{end:p()}],top:[{top:p()}],right:[{right:p()}],bottom:[{bottom:p()}],left:[{left:p()}],visibility:["visible","invisible","collapse"],z:[{z:[N0,"auto",y,B]}],basis:[{basis:[m0,"full","auto",X,...N()]}],"flex-direction":[{flex:["row","row-reverse","col","col-reverse"]}],"flex-wrap":[{flex:["nowrap","wrap","wrap-reverse"]}],flex:[{flex:[n,m0,"auto","initial","none",B]}],grow:[{grow:["",n,y,B]}],shrink:[{shrink:["",n,y,B]}],order:[{order:[N0,"first","last","none",y,B]}],"grid-cols":[{"grid-cols":J0()}],"col-start-end":[{col:i()}],"col-start":[{"col-start":d()}],"col-end":[{"col-end":d()}],"grid-rows":[{"grid-rows":J0()}],"row-start-end":[{row:i()}],"row-start":[{"row-start":d()}],"row-end":[{"row-end":d()}],"grid-flow":[{"grid-flow":["row","col","dense","row-dense","col-dense"]}],"auto-cols":[{"auto-cols":$w()}],"auto-rows":[{"auto-rows":$w()}],gap:[{gap:N()}],"gap-x":[{"gap-x":N()}],"gap-y":[{"gap-y":N()}],"justify-content":[{justify:[...u0(),"normal"]}],"justify-items":[{"justify-items":[...x0(),"normal"]}],"justify-self":[{"justify-self":["auto",...x0()]}],"align-content":[{content:["normal",...u0()]}],"align-items":[{items:[...x0(),{baseline:["","last"]}]}],"align-self":[{self:["auto",...x0(),{baseline:["","last"]}]}],"place-content":[{"place-content":u0()}],"place-items":[{"place-items":[...x0(),"baseline"]}],"place-self":[{"place-self":["auto",...x0()]}],p:[{p:N()}],px:[{px:N()}],py:[{py:N()}],ps:[{ps:N()}],pe:[{pe:N()}],pt:[{pt:N()}],pr:[{pr:N()}],pb:[{pb:N()}],pl:[{pl:N()}],m:[{m:Q0()}],mx:[{mx:Q0()}],my:[{my:Q0()}],ms:[{ms:Q0()}],me:[{me:Q0()}],mt:[{mt:Q0()}],mr:[{mr:Q0()}],mb:[{mb:Q0()}],ml:[{ml:Q0()}],"space-x":[{"space-x":N()}],"space-x-reverse":["space-x-reverse"],"space-y":[{"space-y":N()}],"space-y-reverse":["space-y-reverse"],size:[{size:L()}],w:[{w:[X,"screen",...L()]}],"min-w":[{"min-w":[X,"screen","none",...L()]}],"max-w":[{"max-w":[X,"screen","none","prose",{screen:[Z]},...L()]}],h:[{h:["screen","lh",...L()]}],"min-h":[{"min-h":["screen","lh","none",...L()]}],"max-h":[{"max-h":["screen","lh",...L()]}],"font-size":[{text:["base",z,zw,V0]}],"font-smoothing":["antialiased","subpixel-antialiased"],"font-style":["italic","not-italic"],"font-weight":[{font:[b,y,K1]}],"font-stretch":[{"font-stretch":["ultra-condensed","extra-condensed","condensed","semi-condensed","normal","semi-expanded","expanded","extra-expanded","ultra-expanded",$1,B]}],"font-family":[{font:[d4,B,v]}],"fvn-normal":["normal-nums"],"fvn-ordinal":["ordinal"],"fvn-slashed-zero":["slashed-zero"],"fvn-figure":["lining-nums","oldstyle-nums"],"fvn-spacing":["proportional-nums","tabular-nums"],"fvn-fraction":["diagonal-fractions","stacked-fractions"],tracking:[{tracking:[J,y,B]}],"line-clamp":[{"line-clamp":[n,"none",y,K1]}],leading:[{leading:[Q,...N()]}],"list-image":[{"list-image":["none",y,B]}],"list-style-position":[{list:["inside","outside"]}],"list-style-type":[{list:["disc","decimal","none",y,B]}],"text-alignment":[{text:["left","center","right","justify","start","end"]}],"placeholder-color":[{placeholder:r()}],"text-color":[{text:r()}],"text-decoration":["underline","overline","line-through","no-underline"],"text-decoration-style":[{decoration:[...Kw(),"wavy"]}],"text-decoration-thickness":[{decoration:[n,"from-font","auto",y,V0]}],"text-decoration-color":[{decoration:r()}],"underline-offset":[{"underline-offset":[n,"auto",y,B]}],"text-transform":["uppercase","lowercase","capitalize","normal-case"],"text-overflow":["truncate","text-ellipsis","text-clip"],"text-wrap":[{text:["wrap","nowrap","balance","pretty"]}],indent:[{indent:N()}],"vertical-align":[{align:["baseline","top","middle","bottom","text-top","text-bottom","sub","super",y,B]}],whitespace:[{whitespace:["normal","nowrap","pre","pre-line","pre-wrap","break-spaces"]}],break:[{break:["normal","words","all","keep"]}],wrap:[{wrap:["break-word","anywhere","normal"]}],hyphens:[{hyphens:["none","manual","auto"]}],content:[{content:["none",y,B]}],"bg-attachment":[{bg:["fixed","local","scroll"]}],"bg-clip":[{"bg-clip":["border","padding","content","text"]}],"bg-origin":[{"bg-origin":["border","padding","content"]}],"bg-position":[{bg:b0()}],"bg-repeat":[{bg:o()}],"bg-size":[{bg:f0()}],"bg-image":[{bg:["none",{linear:[{to:["t","tr","r","br","b","bl","l","tl"]},N0,y,B],radial:["",y,B],conic:[N0,y,B]},E4,p4]}],"bg-color":[{bg:r()}],"gradient-from-pos":[{from:U0()}],"gradient-via-pos":[{via:U0()}],"gradient-to-pos":[{to:U0()}],"gradient-from":[{from:r()}],"gradient-via":[{via:r()}],"gradient-to":[{to:r()}],rounded:[{rounded:I()}],"rounded-s":[{"rounded-s":I()}],"rounded-e":[{"rounded-e":I()}],"rounded-t":[{"rounded-t":I()}],"rounded-r":[{"rounded-r":I()}],"rounded-b":[{"rounded-b":I()}],"rounded-l":[{"rounded-l":I()}],"rounded-ss":[{"rounded-ss":I()}],"rounded-se":[{"rounded-se":I()}],"rounded-ee":[{"rounded-ee":I()}],"rounded-es":[{"rounded-es":I()}],"rounded-tl":[{"rounded-tl":I()}],"rounded-tr":[{"rounded-tr":I()}],"rounded-br":[{"rounded-br":I()}],"rounded-bl":[{"rounded-bl":I()}],"border-w":[{border:C()}],"border-w-x":[{"border-x":C()}],"border-w-y":[{"border-y":C()}],"border-w-s":[{"border-s":C()}],"border-w-e":[{"border-e":C()}],"border-w-t":[{"border-t":C()}],"border-w-r":[{"border-r":C()}],"border-w-b":[{"border-b":C()}],"border-w-l":[{"border-l":C()}],"divide-x":[{"divide-x":C()}],"divide-x-reverse":["divide-x-reverse"],"divide-y":[{"divide-y":C()}],"divide-y-reverse":["divide-y-reverse"],"border-style":[{border:[...Kw(),"hidden","none"]}],"divide-style":[{divide:[...Kw(),"hidden","none"]}],"border-color":[{border:r()}],"border-color-x":[{"border-x":r()}],"border-color-y":[{"border-y":r()}],"border-color-s":[{"border-s":r()}],"border-color-e":[{"border-e":r()}],"border-color-t":[{"border-t":r()}],"border-color-r":[{"border-r":r()}],"border-color-b":[{"border-b":r()}],"border-color-l":[{"border-l":r()}],"divide-color":[{divide:r()}],"outline-style":[{outline:[...Kw(),"none","hidden"]}],"outline-offset":[{"outline-offset":[n,y,B]}],"outline-w":[{outline:["",n,zw,V0]}],"outline-color":[{outline:r()}],shadow:[{shadow:["","none",G,Vw,Pw]}],"shadow-color":[{shadow:r()}],"inset-shadow":[{"inset-shadow":["none",Y,Vw,Pw]}],"inset-shadow-color":[{"inset-shadow":r()}],"ring-w":[{ring:C()}],"ring-w-inset":["ring-inset"],"ring-color":[{ring:r()}],"ring-offset-w":[{"ring-offset":[n,V0]}],"ring-offset-color":[{"ring-offset":r()}],"inset-ring-w":[{"inset-ring":C()}],"inset-ring-color":[{"inset-ring":r()}],"text-shadow":[{"text-shadow":["none",k,Vw,Pw]}],"text-shadow-color":[{"text-shadow":r()}],opacity:[{opacity:[n,y,B]}],"mix-blend":[{"mix-blend":[...j1(),"plus-darker","plus-lighter"]}],"bg-blend":[{"bg-blend":j1()}],"mask-clip":[{"mask-clip":["border","padding","content","fill","stroke","view"]},"mask-no-clip"],"mask-composite":[{mask:["add","subtract","intersect","exclude"]}],"mask-image-linear-pos":[{"mask-linear":[n]}],"mask-image-linear-from-pos":[{"mask-linear-from":a()}],"mask-image-linear-to-pos":[{"mask-linear-to":a()}],"mask-image-linear-from-color":[{"mask-linear-from":r()}],"mask-image-linear-to-color":[{"mask-linear-to":r()}],"mask-image-t-from-pos":[{"mask-t-from":a()}],"mask-image-t-to-pos":[{"mask-t-to":a()}],"mask-image-t-from-color":[{"mask-t-from":r()}],"mask-image-t-to-color":[{"mask-t-to":r()}],"mask-image-r-from-pos":[{"mask-r-from":a()}],"mask-image-r-to-pos":[{"mask-r-to":a()}],"mask-image-r-from-color":[{"mask-r-from":r()}],"mask-image-r-to-color":[{"mask-r-to":r()}],"mask-image-b-from-pos":[{"mask-b-from":a()}],"mask-image-b-to-pos":[{"mask-b-to":a()}],"mask-image-b-from-color":[{"mask-b-from":r()}],"mask-image-b-to-color":[{"mask-b-to":r()}],"mask-image-l-from-pos":[{"mask-l-from":a()}],"mask-image-l-to-pos":[{"mask-l-to":a()}],"mask-image-l-from-color":[{"mask-l-from":r()}],"mask-image-l-to-color":[{"mask-l-to":r()}],"mask-image-x-from-pos":[{"mask-x-from":a()}],"mask-image-x-to-pos":[{"mask-x-to":a()}],"mask-image-x-from-color":[{"mask-x-from":r()}],"mask-image-x-to-color":[{"mask-x-to":r()}],"mask-image-y-from-pos":[{"mask-y-from":a()}],"mask-image-y-to-pos":[{"mask-y-to":a()}],"mask-image-y-from-color":[{"mask-y-from":r()}],"mask-image-y-to-color":[{"mask-y-to":r()}],"mask-image-radial":[{"mask-radial":[y,B]}],"mask-image-radial-from-pos":[{"mask-radial-from":a()}],"mask-image-radial-to-pos":[{"mask-radial-to":a()}],"mask-image-radial-from-color":[{"mask-radial-from":r()}],"mask-image-radial-to-color":[{"mask-radial-to":r()}],"mask-image-radial-shape":[{"mask-radial":["circle","ellipse"]}],"mask-image-radial-size":[{"mask-radial":[{closest:["side","corner"],farthest:["side","corner"]}]}],"mask-image-radial-pos":[{"mask-radial-at":R()}],"mask-image-conic-pos":[{"mask-conic":[n]}],"mask-image-conic-from-pos":[{"mask-conic-from":a()}],"mask-image-conic-to-pos":[{"mask-conic-to":a()}],"mask-image-conic-from-color":[{"mask-conic-from":r()}],"mask-image-conic-to-color":[{"mask-conic-to":r()}],"mask-mode":[{mask:["alpha","luminance","match"]}],"mask-origin":[{"mask-origin":["border","padding","content","fill","stroke","view"]}],"mask-position":[{mask:b0()}],"mask-repeat":[{mask:o()}],"mask-size":[{mask:f0()}],"mask-type":[{"mask-type":["alpha","luminance"]}],"mask-image":[{mask:["none",y,B]}],filter:[{filter:["","none",y,B]}],blur:[{blur:D1()}],brightness:[{brightness:[n,y,B]}],contrast:[{contrast:[n,y,B]}],"drop-shadow":[{"drop-shadow":["","none",F,Vw,Pw]}],"drop-shadow-color":[{"drop-shadow":r()}],grayscale:[{grayscale:["",n,y,B]}],"hue-rotate":[{"hue-rotate":[n,y,B]}],invert:[{invert:["",n,y,B]}],saturate:[{saturate:[n,y,B]}],sepia:[{sepia:["",n,y,B]}],"backdrop-filter":[{"backdrop-filter":["","none",y,B]}],"backdrop-blur":[{"backdrop-blur":D1()}],"backdrop-brightness":[{"backdrop-brightness":[n,y,B]}],"backdrop-contrast":[{"backdrop-contrast":[n,y,B]}],"backdrop-grayscale":[{"backdrop-grayscale":["",n,y,B]}],"backdrop-hue-rotate":[{"backdrop-hue-rotate":[n,y,B]}],"backdrop-invert":[{"backdrop-invert":["",n,y,B]}],"backdrop-opacity":[{"backdrop-opacity":[n,y,B]}],"backdrop-saturate":[{"backdrop-saturate":[n,y,B]}],"backdrop-sepia":[{"backdrop-sepia":["",n,y,B]}],"border-collapse":[{border:["collapse","separate"]}],"border-spacing":[{"border-spacing":N()}],"border-spacing-x":[{"border-spacing-x":N()}],"border-spacing-y":[{"border-spacing-y":N()}],"table-layout":[{table:["auto","fixed"]}],caption:[{caption:["top","bottom"]}],transition:[{transition:["","all","colors","opacity","shadow","transform","none",y,B]}],"transition-behavior":[{transition:["normal","discrete"]}],duration:[{duration:[n,"initial",y,B]}],ease:[{ease:["linear","initial",O,y,B]}],delay:[{delay:[n,y,B]}],animate:[{animate:["none",W,y,B]}],backface:[{backface:["hidden","visible"]}],perspective:[{perspective:[H,y,B]}],"perspective-origin":[{"perspective-origin":T()}],rotate:[{rotate:Yw()}],"rotate-x":[{"rotate-x":Yw()}],"rotate-y":[{"rotate-y":Yw()}],"rotate-z":[{"rotate-z":Yw()}],scale:[{scale:qw()}],"scale-x":[{"scale-x":qw()}],"scale-y":[{"scale-y":qw()}],"scale-z":[{"scale-z":qw()}],"scale-3d":["scale-3d"],skew:[{skew:Dw()}],"skew-x":[{"skew-x":Dw()}],"skew-y":[{"skew-y":Dw()}],transform:[{transform:[y,B,"","none","gpu","cpu"]}],"transform-origin":[{origin:T()}],"transform-style":[{transform:["3d","flat"]}],translate:[{translate:Gw()}],"translate-x":[{"translate-x":Gw()}],"translate-y":[{"translate-y":Gw()}],"translate-z":[{"translate-z":Gw()}],"translate-none":["translate-none"],accent:[{accent:r()}],appearance:[{appearance:["none","auto"]}],"caret-color":[{caret:r()}],"color-scheme":[{scheme:["normal","dark","light","light-dark","only-dark","only-light"]}],cursor:[{cursor:["auto","default","pointer","wait","text","move","help","not-allowed","none","context-menu","progress","cell","crosshair","vertical-text","alias","copy","no-drop","grab","grabbing","all-scroll","col-resize","row-resize","n-resize","e-resize","s-resize","w-resize","ne-resize","nw-resize","se-resize","sw-resize","ew-resize","ns-resize","nesw-resize","nwse-resize","zoom-in","zoom-out",y,B]}],"field-sizing":[{"field-sizing":["fixed","content"]}],"pointer-events":[{"pointer-events":["auto","none"]}],resize:[{resize:["none","","y","x"]}],"scroll-behavior":[{scroll:["auto","smooth"]}],"scroll-m":[{"scroll-m":N()}],"scroll-mx":[{"scroll-mx":N()}],"scroll-my":[{"scroll-my":N()}],"scroll-ms":[{"scroll-ms":N()}],"scroll-me":[{"scroll-me":N()}],"scroll-mt":[{"scroll-mt":N()}],"scroll-mr":[{"scroll-mr":N()}],"scroll-mb":[{"scroll-mb":N()}],"scroll-ml":[{"scroll-ml":N()}],"scroll-p":[{"scroll-p":N()}],"scroll-px":[{"scroll-px":N()}],"scroll-py":[{"scroll-py":N()}],"scroll-ps":[{"scroll-ps":N()}],"scroll-pe":[{"scroll-pe":N()}],"scroll-pt":[{"scroll-pt":N()}],"scroll-pr":[{"scroll-pr":N()}],"scroll-pb":[{"scroll-pb":N()}],"scroll-pl":[{"scroll-pl":N()}],"snap-align":[{snap:["start","end","center","align-none"]}],"snap-stop":[{snap:["normal","always"]}],"snap-type":[{snap:["none","x","y","both"]}],"snap-strictness":[{snap:["mandatory","proximity"]}],touch:[{touch:["auto","none","manipulation"]}],"touch-x":[{"touch-pan":["x","left","right"]}],"touch-y":[{"touch-pan":["y","up","down"]}],"touch-pz":["touch-pinch-zoom"],select:[{select:["none","text","all","auto"]}],"will-change":[{"will-change":["auto","scroll","contents","transform",y,B]}],fill:[{fill:["none",...r()]}],"stroke-w":[{stroke:[n,zw,V0,K1]}],stroke:[{stroke:["none",...r()]}],"forced-color-adjust":[{"forced-color-adjust":["auto","none"]}]},conflictingClassGroups:{overflow:["overflow-x","overflow-y"],overscroll:["overscroll-x","overscroll-y"],inset:["inset-x","inset-y","start","end","top","right","bottom","left"],"inset-x":["right","left"],"inset-y":["top","bottom"],flex:["basis","grow","shrink"],gap:["gap-x","gap-y"],p:["px","py","ps","pe","pt","pr","pb","pl"],px:["pr","pl"],py:["pt","pb"],m:["mx","my","ms","me","mt","mr","mb","ml"],mx:["mr","ml"],my:["mt","mb"],size:["w","h"],"font-size":["leading"],"fvn-normal":["fvn-ordinal","fvn-slashed-zero","fvn-figure","fvn-spacing","fvn-fraction"],"fvn-ordinal":["fvn-normal"],"fvn-slashed-zero":["fvn-normal"],"fvn-figure":["fvn-normal"],"fvn-spacing":["fvn-normal"],"fvn-fraction":["fvn-normal"],"line-clamp":["display","overflow"],rounded:["rounded-s","rounded-e","rounded-t","rounded-r","rounded-b","rounded-l","rounded-ss","rounded-se","rounded-ee","rounded-es","rounded-tl","rounded-tr","rounded-br","rounded-bl"],"rounded-s":["rounded-ss","rounded-es"],"rounded-e":["rounded-se","rounded-ee"],"rounded-t":["rounded-tl","rounded-tr"],"rounded-r":["rounded-tr","rounded-br"],"rounded-b":["rounded-br","rounded-bl"],"rounded-l":["rounded-tl","rounded-bl"],"border-spacing":["border-spacing-x","border-spacing-y"],"border-w":["border-w-x","border-w-y","border-w-s","border-w-e","border-w-t","border-w-r","border-w-b","border-w-l"],"border-w-x":["border-w-r","border-w-l"],"border-w-y":["border-w-t","border-w-b"],"border-color":["border-color-x","border-color-y","border-color-s","border-color-e","border-color-t","border-color-r","border-color-b","border-color-l"],"border-color-x":["border-color-r","border-color-l"],"border-color-y":["border-color-t","border-color-b"],translate:["translate-x","translate-y","translate-none"],"translate-none":["translate","translate-x","translate-y","translate-z"],"scroll-m":["scroll-mx","scroll-my","scroll-ms","scroll-me","scroll-mt","scroll-mr","scroll-mb","scroll-ml"],"scroll-mx":["scroll-mr","scroll-ml"],"scroll-my":["scroll-mt","scroll-mb"],"scroll-p":["scroll-px","scroll-py","scroll-ps","scroll-pe","scroll-pt","scroll-pr","scroll-pb","scroll-pl"],"scroll-px":["scroll-pr","scroll-pl"],"scroll-py":["scroll-pt","scroll-pb"],touch:["touch-x","touch-y","touch-pz"],"touch-x":["touch"],"touch-y":["touch"],"touch-pz":["touch"]},conflictingClassGroupModifiers:{"font-size":["leading"]},orderSensitiveModifiers:["*","**","after","backdrop","before","details-content","file","first-letter","first-line","marker","placeholder","selection"]}};var e2=L4(o4);var $0=(...w)=>e2(h2(...w));var L0={weight:{normal:{class:"font-normal",label:"Normal"},medium:{class:"font-medium",label:"Medium"},semibold:{class:"font-semibold",label:"Semibold"},bold:{class:"font-bold",label:"Bold"}},decoration:{none:{class:"no-underline",label:"None"},underline:{class:"underline",label:"Underline"},lineThrough:{class:"line-through",label:"Strikethrough"}},style:{normal:{class:"not-italic",label:"Normal"},italic:{class:"italic",label:"Italic"}},color:{inherit:{class:"text-inherit",label:"Inherit"},slate:{class:"text-slate-700",label:"Slate"},gray:{class:"text-gray-700",label:"Gray"},red:{class:"text-red-600",label:"Red"},orange:{class:"text-orange-600",label:"Orange"},amber:{class:"text-amber-600",label:"Amber"},green:{class:"text-green-600",label:"Green"},blue:{class:"text-blue-600",label:"Blue"},purple:{class:"text-purple-600",label:"Purple"}},highlight:{none:{class:"",label:"None"},yellow:{class:"bg-yellow-200",label:"Yellow"},green:{class:"bg-green-200",label:"Green"},blue:{class:"bg-blue-200",label:"Blue"},pink:{class:"bg-pink-200",label:"Pink"}},size:{xs:{class:"text-xs",label:"XS"},sm:{class:"text-sm",label:"SM"},base:{class:"text-base",label:"Base"},lg:{class:"text-lg",label:"LG"},xl:{class:"text-xl",label:"XL"},"2xl":{class:"text-2xl",label:"2XL"}}},w5={weight:"normal",decoration:"none",style:"normal",color:"inherit",highlight:"none",size:"base"},G1=new Map;for(let[w,v]of Object.entries(L0))for(let[z,b]of Object.entries(v))if(b.class)G1.set(b.class,{category:w,key:z});var g4=new Set(G1.keys());function Jw(w){let v=window.getSelection();if(!v||v.isCollapsed||v.rangeCount===0)return null;let z=v.getRangeAt(0);if(!w.contains(z.commonAncestorContainer))return null;let b=v.toString();if(!b.trim())return null;let{anchorNode:J,focusNode:Q}=v;if(!J||!Q)return null;return{startOffset:z.startOffset,endOffset:z.endOffset,text:b,range:z,anchorNode:J,focusNode:Q}}function bw(w){let v=[];for(let[z,b]of Object.entries(w)){if(b===void 0)continue;let J=w5[z];if(b===J)continue;let Z=L0[z][b];if(Z?.class)v.push(Z.class)}return v.join(" ")}function K0(w){if(!w)return{};let v=w.split(/\s+/).filter(Boolean),z={};for(let b of v){let J=G1.get(b);if(J)z[J.category]=J.key}return z}function c4(w){let v=w.split(/\s+/).filter(Boolean),z=[],b=[];for(let J of v)if(g4.has(J))z.push(J);else b.push(J);return{styleClasses:z,otherClasses:b}}function Tw(w){let v=document.createElement("span");v.setAttribute("data-cms-styled","true");let z=bw(w);if(z)v.className=z;return v}function Qw(w){let v=window.getSelection();if(!v||v.rangeCount===0)return null;let b=v.getRangeAt(0).commonAncestorContainer,J=b.nodeType===Node.TEXT_NODE?b.parentElement:b;while(J!==null&&J!==w){if(J.hasAttribute("data-cms-styled"))return J;J=J.parentElement}return null}function a4(w){let v=w.parentNode;if(!v)return;while(w.firstChild)v.insertBefore(w.firstChild,w);v.removeChild(w),v.normalize()}function q1(w,v){let z=K0(w.className),{otherClasses:b}=c4(w.className),J={...z,...v},Q=bw(J);if(Q||b.length>0)w.className=[...b,Q].filter(Boolean).join(" ");else a4(w)}function u4(w,v){let z=(J)=>{if(J.nodeType===Node.ELEMENT_NODE){let Q=J;if(Q.hasAttribute("data-cms-styled")){let Z=K0(Q.className),K={...K0(v.className),...Z};v.className=bw(K)||"";let $=Array.from(Q.childNodes);for(let G of $)z(G)}else{let Z=Q.cloneNode(!1),X=Array.from(Q.childNodes);for(let K of X)if(K.nodeType===Node.ELEMENT_NODE){let $=K;if($.hasAttribute("data-cms-styled")){let G=Array.from($.childNodes);for(let x of G)Z.appendChild(x.cloneNode(!0));let Y=K0($.className),F={...K0(v.className),...Y};v.className=bw(F)||""}else Z.appendChild(K.cloneNode(!0))}else Z.appendChild(K.cloneNode(!0));v.appendChild(Z)}}else v.appendChild(J.cloneNode(!0))},b=Array.from(w.childNodes);for(let J of b)z(J)}function i4(w,v){let z=w.nextSibling;while(z&&z!==v){if(z.nodeType===Node.TEXT_NODE){if(z.textContent&&z.textContent.trim()!=="")return!1}else if(z.nodeType===Node.ELEMENT_NODE)return!1;z=z.nextSibling}return z===v}function v5(w){let v=Array.from(w.querySelectorAll("[data-cms-styled]"));for(let z of v)if(!z.textContent&&!z.querySelector("*"))z.remove()}function z5(w){let v=Array.from(w.querySelectorAll("[data-cms-styled]")),z=!0;while(z){z=!1,v=Array.from(w.querySelectorAll("[data-cms-styled]"));for(let b=0;b<v.length-1;b++){let J=v[b],Q=v[b+1];if(!J.parentNode||!Q.parentNode)continue;if(i4(J,Q)&&J.className===Q.className){while(Q.firstChild)J.appendChild(Q.firstChild);Q.remove(),z=!0;break}}}v5(w),w.normalize()}function l4(w,v,z){let b=bw(z),J=Qw(w);if(J){let Q=v.range,Z=document.createRange();if(Z.selectNodeContents(J),Q.compareBoundaryPoints(Range.START_TO_START,Z)===0&&Q.compareBoundaryPoints(Range.END_TO_END,Z)===0)return q1(J,z),J;return s4(w,J,v,z)}if(!b)return null;try{let Q=Tw(z),Z=v.range.extractContents();return u4(Z,Q),v.range.insertNode(Q),w.normalize(),z5(w),Q}catch(Q){return console.error("[CMS] Failed to wrap selection:",Q),null}}function s4(w,v,z,b){try{let J=z.range,Q=K0(v.className),Z=document.createRange();Z.setStart(v,0),Z.setEnd(J.startContainer,J.startOffset);let X=document.createRange();X.setStart(J.endContainer,J.endOffset),X.setEndAfter(v.lastChild||v);let K=Z.extractContents(),$=J.extractContents(),G=X.extractContents(),Y=v.parentNode;if(!Y)return null;let k=K.textContent?.trim()||K.querySelector("*")?Tw(Q):null,F=Tw({...Q,...b}),x=G.textContent?.trim()||G.querySelector("*")?Tw(Q):null;if(k)k.appendChild(K);if(F.appendChild($),x)x.appendChild(G);if(k)Y.insertBefore(k,v);if(Y.insertBefore(F,v),x)Y.insertBefore(x,v);return v.remove(),v5(w),z5(w),w.normalize(),F}catch(J){return console.error("[CMS] Failed to split and style selection:",J),null}}function t4(w,v,z){let b=Jw(w);if(!b)return null;let J={[v]:z};return l4(w,b,J)}function b5(w,v,z){let b=Qw(w);if(b)if(K0(b.className)[v]===z){let Z=w5[v];return q1(b,{[v]:Z}),null}else return q1(b,{[v]:z}),b;return t4(w,v,z)}function F1(w){let v=Qw(w);if(!v)return{};return K0(v.className)}function J5(w,v){let z=L0[w];return typeof v==="string"&&v in z}var Q5='<div aria-hidden="true" class="!hidden font-normal font-medium font-semibold font-bold no-underline underline line-through not-italic italic text-inherit text-slate-700 text-gray-700 text-red-600 text-orange-600 text-amber-600 text-green-600 text-blue-600 text-purple-600 bg-yellow-200 bg-green-200 bg-blue-200 bg-pink-200 text-xs text-sm text-base text-lg text-xl text-2xl"></div>';function fw({label:w,icon:v,isActive:z,onClick:b}){return q("button",{type:"button",onClick:b,title:w,class:$0("w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer",z?"bg-blue-bold text-white":"hover:bg-slate-100 text-slate-700"),children:v},void 0,!1,void 0,this)}function e4({color:w,label:v,isActive:z,onClick:b}){return q("button",{type:"button",onClick:b,title:v,class:$0("w-5 h-5 rounded-full border-2 transition-transform cursor-pointer",z?"border-blue-bold scale-125":"border-transparent hover:scale-110"),style:{backgroundColor:w}},void 0,!1,void 0,this)}var Zw={inherit:"#374151",slate:"#334155",gray:"#374151",red:"#dc2626",orange:"#ea580c",amber:"#d97706",green:"#16a34a",blue:"#2563eb",purple:"#9333ea"},Z5={none:"transparent",yellow:"#fef08a",green:"#bbf7d0",blue:"#bfdbfe",pink:"#fbcfe8"};function X5({visible:w,rect:v,element:z,onStyleChange:b}){let[J,Q]=f({}),[Z,X]=f(!1),[K,$]=f(!1);D(()=>{if(!w||!z){Q({}),X(!1),$(!1);return}let W=()=>{Q(F1(z))};return W(),document.addEventListener("selectionchange",W),()=>document.removeEventListener("selectionchange",W)},[w,z]);let G=h((W,A)=>{if(!z)return;if(!J5(W,A)){console.warn(`[CMS] Invalid style value: ${W}=${String(A)}`);return}let R=Jw(z),T=Qw(z);if(!R&&!T)return;let U=z.getAttribute(M.ID_ATTRIBUTE);if(U)C0(U);let S=b5(z,W,A);if(z.dispatchEvent(new Event("input",{bubbles:!0})),S)Q(K0(S.className));else if(T)if(T.parentElement)Q(K0(T.className));else Q({});else Q(F1(z));b?.()},[z,b]);if(!w||!v)return null;let Y=44,k=320,F=v.left+v.width/2-k/2,x=v.top-Y-8,H=10,_=window.innerWidth-k-H;if(F=Math.max(H,Math.min(F,_)),x<H)x=v.bottom+8;return q("div",{"data-cms-ui":!0,onMouseDown:(W)=>W.stopPropagation(),onClick:(W)=>W.stopPropagation(),style:{position:"fixed",left:`${F}px`,top:`${x}px`,zIndex:R2.MODAL,fontFamily:"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",fontSize:"12px"},children:q("div",{class:"flex items-center gap-1 px-2 py-1.5 bg-white border-2 border-black shadow-brutalist-sm rounded",children:[q(fw,{category:"weight",value:"bold",label:"Bold",isActive:J.weight==="bold",onClick:()=>G("weight","bold"),icon:q("span",{class:"font-bold text-sm",children:"B"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(fw,{category:"style",value:"italic",label:"Italic",isActive:J.style==="italic",onClick:()=>G("style","italic"),icon:q("span",{class:"italic text-sm",children:"I"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(fw,{category:"decoration",value:"underline",label:"Underline",isActive:J.decoration==="underline",onClick:()=>G("decoration","underline"),icon:q("span",{class:"underline text-sm",children:"U"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(fw,{category:"decoration",value:"lineThrough",label:"Strikethrough",isActive:J.decoration==="lineThrough",onClick:()=>G("decoration","lineThrough"),icon:q("span",{class:"line-through text-sm",children:"S"},void 0,!1,void 0,this)},void 0,!1,void 0,this),q("div",{class:"w-px h-5 bg-slate-200 mx-1"},void 0,!1,void 0,this),q("div",{class:"relative",children:[q("button",{type:"button",onClick:()=>{X(!Z),$(!1)},title:"Text Color",class:$0("w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer",Z?"bg-slate-100":"hover:bg-slate-100"),children:[q("span",{class:"text-sm",style:{color:J.color?Zw[J.color]:Zw.inherit},children:"A"},void 0,!1,void 0,this),q("div",{class:"absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded",style:{backgroundColor:J.color?Zw[J.color]:Zw.inherit}},void 0,!1,void 0,this)]},void 0,!0,void 0,this),Z&&q("div",{class:"absolute top-full left-0 mt-1 p-2 bg-white border-2 border-black shadow-brutalist-sm rounded flex gap-1.5 flex-wrap w-32 z-10",children:Object.entries(Zw).map(([W,A])=>q(e4,{color:A,tailwindClass:L0.color[W]?.class||"",label:L0.color[W]?.label||W,isActive:J.color===W,onClick:()=>{G("color",W),X(!1)}},W,!1,void 0,this))},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"relative",children:[q("button",{type:"button",onClick:()=>{$(!K),X(!1)},title:"Highlight",class:$0("w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer",K?"bg-slate-100":"hover:bg-slate-100"),children:[q("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[q("path",{d:"M12 20h9"},void 0,!1,void 0,this),q("path",{d:"M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"absolute bottom-0.5 left-1 right-1 h-1.5 rounded",style:{backgroundColor:J.highlight?Z5[J.highlight]:"transparent",border:J.highlight&&J.highlight!=="none"?"none":"1px solid #e2e8f0"}},void 0,!1,void 0,this)]},void 0,!0,void 0,this),K&&q("div",{class:"absolute top-full left-0 mt-1 p-2 bg-white border-2 border-black shadow-brutalist-sm rounded flex gap-1.5 flex-wrap w-28 z-10",children:Object.entries(Z5).map(([W,A])=>q("button",{type:"button",onClick:()=>{G("highlight",W),$(!1)},title:L0.highlight[W]?.label||W,class:$0("w-5 h-5 rounded border-2 transition-transform cursor-pointer",J.highlight===W?"border-blue-bold scale-125":"border-slate-200 hover:scale-110"),style:{backgroundColor:A==="transparent"?"#fff":A}},W,!1,void 0,this))},void 0,!1,void 0,this)]},void 0,!0,void 0,this),q("div",{class:"w-px h-5 bg-slate-200 mx-1"},void 0,!1,void 0,this),q("select",{value:J.size||"base",onChange:(W)=>G("size",W.target.value),class:"h-7 px-1 text-xs border border-slate-200 rounded bg-white cursor-pointer hover:border-slate-300 focus:outline-none focus:border-blue-bold",children:Object.entries(L0.size).map(([W,{label:A}])=>q("option",{value:W,children:A},W,!1,void 0,this))},void 0,!1,void 0,this)]},void 0,!0,void 0,this)},void 0,!1,void 0,this)}var $5=({id:w,message:v,type:z,onRemove:b})=>{let[J,Q]=f(!0);return D(()=>{let X=setTimeout(()=>{Q(!1)},X0.TOAST_VISIBLE_DURATION_MS),K=setTimeout(()=>{b(w)},X0.TOAST_VISIBLE_DURATION_MS+X0.TOAST_FADE_DURATION_MS);return()=>{clearTimeout(X),clearTimeout(K)}},[w,b]),q("div",{class:`
        px-4 py-3 font-sans text-[13px] font-bold uppercase tracking-wide
        shadow-brutalist-sm border-2 border-black
        transition-all duration-300 ease-out flex items-center gap-3
        ${{error:"bg-white border-l-4 border-l-red-600 text-slate-800",success:"bg-white border-l-4 border-l-emerald-600 text-slate-800",info:"bg-white border-l-4 border-l-blue-600 text-slate-800"}[z]}
        ${J?"opacity-100 translate-y-0 scale-100":"opacity-0 translate-y-2 scale-95"}
      `,children:[z==="success"&&q("span",{class:"text-emerald-600 font-black text-lg",children:"✓"},void 0,!1,void 0,this),z==="error"&&q("span",{class:"text-red-600 font-black text-lg",children:"✕"},void 0,!1,void 0,this),z==="info"&&q("span",{class:"text-blue-600 font-black text-lg",children:"ℹ"},void 0,!1,void 0,this),v]},void 0,!0,void 0,this)};var K5=({toasts:w,onRemove:v})=>{return q("div",{class:"fixed left-1/2 -translate-x-1/2 bottom-20 z-2147483648 flex flex-col gap-2 items-center",children:w.map((z)=>q($5,{...z,onRemove:v},z.id,!1,void 0,this))},void 0,!1,void 0,this)};var Y5=({callbacks:w})=>{let v=v0.value,z=e0.value,b=q0.value,J=Z0.value,Q=w1.value,Z=b?G0(b):null,X=Z?.isDirty?"text-blue-bold":"text-slate-400",K=Z?.isDirty?"opacity-100":"opacity-70",$=v&&!z,G=(Y)=>Y.stopPropagation();return q("div",{class:"fixed bottom-8 left-1/2 z-2147483647 -translate-x-1/2 min-w-md font-sans transition-all duration-300 flex","data-cms-ui":!0,onMouseDown:G,onClick:G,children:[q("div",{class:"flex-1 gap-4 text-sm pl-5 pr-3 py-3 flex items-center bg-blue-bold border-4 border-black text-slate-600 shadow-brutalist-sm md:shadow-brutalist-md",children:q("div",{class:"flex items-center gap-6 grow",children:[b&&v&&q("div",{class:$0("text-[11px] font-mono transition-colors",K,X),children:["Editing: ",b]},void 0,!0,void 0,this),q("div",{class:"font-medium text-white",children:Q===0?"Let's start editing...":`${Q} change${Q!==1?"s":""}`},void 0,!1,void 0,this)]},void 0,!0,void 0,this)},void 0,!1,void 0,this),v&&Q>0&&q(Xw,{onClick:w.onCompare,class:$0("border-y-4 border-x-2 border-black",z?"bg-amber-100 text-amber-700 hover:bg-amber-200":"bg-slate-100 text-slate-600 hover:bg-slate-200"),children:z?"Show Edits":"Show Original"},void 0,!1,void 0,this),$&&q(Xw,{onClick:()=>w.onAIChat?.(),class:$0("border-y-4 border-x-2 border-black bg-purple-600 text-white hover:bg-purple-800"),children:J?"Close Chat":"AI Chat"},void 0,!1,void 0,this),(!v||Q<1)&&q(Xw,{onClick:w.onEdit,class:"bg-black text-white",children:v?"Done":"Edit"},void 0,!1,void 0,this),Q>0&&!z&&q(l,{children:[q(Xw,{class:"text-white bg-green-600 hover:bg-green-800 border-y-4 border-x-2 border-black",onClick:w.onSave,children:"Save"},void 0,!1,void 0,this),q(Xw,{onClick:w.onDiscard,class:"bg-rose-600 text-white hover:bg-rose-700 border-y-4 border-x-2 border-r-4 border-black",children:"Discard"},void 0,!1,void 0,this)]},void 0,!0,void 0,this)]},void 0,!0,void 0,this)},Xw=({children:w,onClick:v,class:z})=>{return q("button",{onClick:(b)=>{b.stopPropagation(),v()},class:$0("cursor-pointer px-4 py-2 font-medium transition-all duration-200 flex items-center justify-center shadow-brutalist-sm md:shadow-brutalist-md",z),children:w},void 0,!1,void 0,this)};var q5=new WeakMap,Y0=null,G5=!1;class F5 extends HTMLElement{shadow;overlayElement;resizeObserver=null;targetElement=null;animationFrameId=null;constructor(){super();this.shadow=this.attachShadow({mode:"open"});let w=document.createElement("style");w.textContent=`
      :host {
        position: absolute;
        pointer-events: none;
        z-index: 2147483645;
        box-sizing: border-box;
      }

      .overlay {
        position: absolute;
        inset: 0;
        border-radius: 0;
        box-sizing: border-box;
        transition: border-color 150ms ease, border-style 150ms ease;
        box-shadow: 4px 4px 0px 0px rgba(0,0,0,0.2);
      }
    `,this.overlayElement=document.createElement("div"),this.overlayElement.className="overlay",this.shadow.appendChild(w),this.shadow.appendChild(this.overlayElement)}connectedCallback(){this.startPositionTracking()}disconnectedCallback(){this.stopPositionTracking()}setTarget(w){if(this.targetElement=w,this.updatePosition(),this.resizeObserver)this.resizeObserver.disconnect();this.resizeObserver=new ResizeObserver(()=>{this.updatePosition()}),this.resizeObserver.observe(w)}setHighlightStyle(w,v){this.overlayElement.style.borderWidth="4px",this.overlayElement.style.borderColor=w,this.overlayElement.style.borderStyle=v}updatePosition(){if(!this.targetElement)return;let w=this.targetElement.getBoundingClientRect(),v=window.scrollX,z=window.scrollY;this.style.left=`${w.left+v-2}px`,this.style.top=`${w.top+z-2}px`,this.style.width=`${w.width+4}px`,this.style.height=`${w.height+4}px`}startPositionTracking(){let w=()=>{this.updatePosition(),this.animationFrameId=requestAnimationFrame(w)};this.animationFrameId=requestAnimationFrame(w)}stopPositionTracking(){if(this.animationFrameId!==null)cancelAnimationFrame(this.animationFrameId),this.animationFrameId=null;if(this.resizeObserver)this.resizeObserver.disconnect(),this.resizeObserver=null}}function w6(){if(G5)return;if(typeof window>"u"||typeof customElements>"u")return;if(!customElements.get("cms-highlight-overlay"))customElements.define("cms-highlight-overlay",F5);G5=!0}function k1(){if(typeof document>"u")return;if(Y0)return;w6(),Y0=document.createElement("div"),Y0.id="cms-highlight-container",Y0.style.cssText=`
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 2147483645;
  `,document.body.appendChild(Y0)}function k5(){if(Y0)Y0.remove(),Y0=null}function _5(w,v,z="solid"){k1();let b=q5.get(w);if(!b)b=document.createElement("cms-highlight-overlay"),q5.set(w,b),Y0?.appendChild(b),b.setTarget(w);b.setHighlightStyle(v,z)}function W5(){if(Y0)Y0.innerHTML=""}function _1(w,v,z){let b=document.elementsFromPoint(w,v);for(let J of b){if(!(J instanceof HTMLElement))continue;if(!J.hasAttribute(M.ID_ATTRIBUTE))continue;if(J.hasAttribute(M.COMPONENT_ID_ATTRIBUTE))continue;let Q=J.getAttribute(M.ID_ATTRIBUTE);if(z&&Q&&!z[Q])continue;if(J.contentEditable==="true")return J}for(let J of b){if(!(J instanceof HTMLElement))continue;if(!J.hasAttribute(M.ID_ATTRIBUTE))continue;if(J.hasAttribute(M.COMPONENT_ID_ATTRIBUTE))continue;let Q=J.getAttribute(M.ID_ATTRIBUTE);if(z&&Q&&!z[Q])continue;return J}return null}function W1(w,v){let z=document.elementsFromPoint(w,v);for(let b of z){if(!(b instanceof HTMLElement))continue;if(b.hasAttribute(M.COMPONENT_ID_ATTRIBUTE))return b}return null}function x1(w,v,z,b=24){if(w<z.left||w>z.right||v<z.top||v>z.bottom)return!1;let J=w-z.left<b,Q=z.right-w<b,Z=v-z.top<b,X=z.bottom-v<b;return J||Q||Z||X}function v6(w){let v="";return w.childNodes.forEach((z)=>{if(z.nodeType===Node.TEXT_NODE)v+=z.nodeValue||"";else if(z.nodeType===Node.ELEMENT_NODE){let b=z,J=b.getAttribute(M.ID_ATTRIBUTE);if(J)v+=`{{cms:${J}}}`;else v+=b.textContent||""}}),v}function c0(w){return v6(w).trim()}function H1(w){let v=w.cloneNode(!0);return v.removeAttribute("contenteditable"),v.querySelectorAll("[contenteditable]").forEach((z)=>{z.removeAttribute("contenteditable")}),v.innerHTML}function x5(w){return Array.from(w.querySelectorAll(`[${M.ID_ATTRIBUTE}]`)).map((v)=>({id:v.getAttribute(M.ID_ATTRIBUTE)||"",placeholder:`__CMS_CHILD_${v.getAttribute(M.ID_ATTRIBUTE)}__`}))}function H5(w){if(!w||!(w instanceof HTMLElement))return null;let v=w;while(v&&v!==document.body){if(v.hasAttribute(M.ID_ATTRIBUTE)&&v.contentEditable==="true")return v;v=v.parentElement}return null}function B1(){return document.querySelectorAll(`[${M.ID_ATTRIBUTE}]`)}function y1(w){w.contentEditable="true"}function a0(w){w.contentEditable="false"}function T0(w,v,z="solid"){_5(w,v,z)}function B5(){k1()}function r1(){W5(),k5()}function V(w,...v){if(!w)return;console.debug("[CMS]",...v)}function y5(){document.querySelectorAll("a").forEach((b)=>{b.setAttribute("data-cms-disabled","true"),b.addEventListener("click",g0,!0)}),document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"]').forEach((b)=>{b.setAttribute("data-cms-disabled","true"),b.addEventListener("click",g0,!0)}),document.querySelectorAll("form").forEach((b)=>{b.setAttribute("data-cms-disabled","true"),b.addEventListener("submit",g0,!0)})}function r5(){document.querySelectorAll("a[data-cms-disabled]").forEach((b)=>{b.removeAttribute("data-cms-disabled"),b.removeEventListener("click",g0,!0)}),document.querySelectorAll("button[data-cms-disabled], input[data-cms-disabled]").forEach((b)=>{b.removeAttribute("data-cms-disabled"),b.removeEventListener("click",g0,!0)}),document.querySelectorAll("form[data-cms-disabled]").forEach((b)=>{b.removeAttribute("data-cms-disabled"),b.removeEventListener("submit",g0,!0)})}function g0(w){if(w.currentTarget.hasAttribute("data-cms-disabled"))w.preventDefault(),w.stopPropagation(),w.stopImmediatePropagation()}async function O5(w,v={},z=Mw.REQUEST_TIMEOUT_MS){let b=new AbortController,J=setTimeout(()=>b.abort(),z);try{return await fetch(w,{...v,signal:b.signal})}finally{clearTimeout(J)}}function z6(w){let v=w;if(v.length>1&&v.endsWith("/"))v=v.slice(0,-1);if(v==="/"||v==="")return"/index.json";return`/${v.replace(/^\//,"")}.json`}async function N5(){let w=window.location.pathname,v=[z6(w),"/cms-manifest.json"],z=null;for(let b of v)try{let J=await O5(b);if(J.ok)return J.json()}catch(J){z=J instanceof Error?J:Error(String(J))}throw z||Error("Failed to load manifest from all sources")}async function L5(w,v){let z=await O5(`${w}/update`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(v)});if(!z.ok){let b=await z.text().catch(()=>"");throw Error(`Save failed (${z.status}): ${b||z.statusText}`)}return z.json().catch(()=>({updated:0}))}function O1(w){let v={};w.forEach((z,b)=>{if(z.isDirty)v[b]={originalText:z.originalText,newText:z.newText,hasStyledContent:z.hasStyledContent}});try{sessionStorage.setItem(nw.PENDING_EDITS,JSON.stringify(v))}catch(z){console.warn("[CMS] Failed to save edits to storage:",z)}}function U5(){try{let w=sessionStorage.getItem(nw.PENDING_EDITS);return w?JSON.parse(w):{}}catch(w){return console.warn("[CMS] Failed to load edits from storage:",w),{}}}function N1(){try{sessionStorage.removeItem(nw.PENDING_EDITS)}catch(w){console.warn("[CMS] Failed to clear edits from storage:",w)}}function A5(w){return w.querySelector("[data-cms-styled]")!==null}async function M5(w,v){v1(!0),y5(),B5(),v?.();try{let J=await N5();O2(J);let Q=V2(J);V(w.debug,"Loaded manifest with",Q,"entries")}catch(J){console.error("[CMS] Failed to load manifest:",J);return}let z=U5(),b=z0.value;B1().forEach((J)=>{let Q=J.getAttribute(M.ID_ATTRIBUTE);if(!Q)return;if(J.hasAttribute(M.COMPONENT_ID_ATTRIBUTE)){V(w.debug,"Skipping component element:",Q),a0(J);return}if(!P2(b,Q)){V(w.debug,"Skipping element not in manifest:",Q),a0(J);return}if(y1(J),!t.value.has(Q)){let Z=J.innerHTML,X=c0(J);V(w.debug,"Setting up element:",Q,"originalText:",X);let K=x5(J),$=z[Q],G=Z,Y=X,k=!1;if($)G=$.currentHTML,Y=$.newText,k=!0,J.innerHTML=G;let F=A5(J);N2(Q,{element:J,originalHTML:Z,originalText:X,newText:Y,currentHTML:G,isDirty:k,childCmsElements:K,hasStyledContent:F})}J.addEventListener("input",(Z)=>{let X=q0.value;if(V(w.debug,"Input event on",Q,"currentEditingId:",X,"target:",Z.target.getAttribute("data-cms-id")),X===Q)Z.stopPropagation(),V(w.debug,"Handling input for",Q),jw(w,Q,J,v);else V(w.debug,"Skipping input - not current editing element, expected:",X)}),J.addEventListener("click",(Z)=>{if(Z.detail!==1)return;let X=H5(Z.target);if(X){let K=X.getAttribute("data-cms-id");if(X.focus(),C0(K),Z0.value&&K)ww(K);V(w.debug,"Click - focusing innermost CMS element:",K),v?.()}},!0),J.addEventListener("focus",(Z)=>{if(Z.target===J){if(C0(Q),Z0.value&&Q)ww(Q);V(w.debug,"Focus on",Q),v?.()}},!1),J.addEventListener("blur",(Z)=>{let X=Z.relatedTarget;if(X?.hasAttribute(M.ID_ATTRIBUTE))return;if(X?.hasAttribute(M.UI_ATTRIBUTE)||X?.closest(`[${M.UI_ATTRIBUTE}]`))return;setTimeout(()=>{let K=document.activeElement;if(K?.hasAttribute(M.UI_ATTRIBUTE)||K?.closest(`[${M.UI_ATTRIBUTE}]`))return;if(q0.value===Q)C0(null),v?.()},X0.BLUR_DELAY_MS)})})}function L1(w){v1(!1),z1(!1),r5(),r1(),w?.(),B1().forEach((v)=>{a0(v)})}function jw(w,v,z,b){V(w.debug,"handleElementChange called for",v);let J=G0(v);if(!J){V(w.debug,"ERROR: No change tracked for",v),V(w.debug,"Available IDs in pendingChanges:",Array.from(t.value.keys())),V(w.debug,"Element:",z.tagName,z.textContent?.substring(0,50));return}let Q=z.innerHTML,Z=A5(z),X=Z?H1(z):c0(z),K=X!==J.originalText,$=Q!==J.originalHTML,G=K||$,Y=J.childCmsElements?.map((k)=>{let F=z.querySelector(`[data-cms-id="${k.id}"]`);if(F)return{...k,currentHTML:F.outerHTML};return k});if(J1(v,(k)=>({...k,newText:X,currentHTML:Q,isDirty:G,childCmsElements:Y,hasStyledContent:Z})),G)T0(z,w.highlightColor,"solid");else T0(z,w.highlightColor,"dashed");V(w.debug,`Change tracked for ${v}:`,{originalText:J.originalText,newText:X,isDirty:G,textChanged:K,htmlChanged:$,hasStyledContent:Z}),O1(t.value),b?.()}function n5(w,v){let z=!e0.value;z1(z),t.value.forEach((b)=>{if(z)b.element.innerHTML=b.originalHTML,a0(b.element),T0(b.element,"#f59e0b","solid");else if(b.element.innerHTML=b.currentHTML||b.originalHTML,y1(b.element),b.isDirty)T0(b.element,w.highlightColor,"solid");else T0(b.element,w.highlightColor,"dashed")}),v?.()}function R5(w){if(!confirm("Discard all changes?"))return;t.value.forEach((v)=>{v.element.innerHTML=v.originalHTML,a0(v.element)}),r1(),L2(),N1(),L1(w)}async function P5(w,v){let z=r2.value;if(z.length===0)return{success:!0,updated:0};try{let b=z.map(([Q,Z])=>{let X={cmsId:Q,newValue:Z.newText};if(Z.childCmsElements&&Z.childCmsElements.length>0)X.childCmsIds=Z.childCmsElements.map((K)=>K.id);if(Z.hasStyledContent)X.hasStyledContent=!0,X.htmlValue=H1(Z.element);return X}),J=await L5(w.apiBase,{changes:b,meta:{source:"inline-editor",url:window.location.href}});if(M0(()=>{z.forEach(([Q,Z])=>{J1(Q,(X)=>({...X,originalText:X.newText,originalHTML:X.element.innerHTML,currentHTML:X.element.innerHTML,isDirty:!1})),T0(Z.element,w.highlightColor,"dashed")})}),N1(),J.errors&&J.errors.length>0)return console.error("[CMS] Save errors:",J.errors),{success:!1,updated:J.updated,errors:J.errors};return v?.(),{success:!0,updated:J.updated}}catch(b){throw console.error("[CMS] Save failed:",b),O1(t.value),b}}var V5=`/*! tailwindcss v4.1.18 | MIT License | https://tailwindcss.com */
@layer properties;
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",
      "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    --color-red-50: oklch(97.1% 0.013 17.38);
    --color-red-100: oklch(93.6% 0.032 17.717);
    --color-red-300: oklch(80.8% 0.114 19.571);
    --color-red-500: oklch(63.7% 0.237 25.331);
    --color-red-600: oklch(57.7% 0.245 27.325);
    --color-red-700: oklch(50.5% 0.213 27.518);
    --color-red-800: oklch(44.4% 0.177 26.899);
    --color-orange-600: oklch(64.6% 0.222 41.116);
    --color-amber-100: oklch(96.2% 0.059 95.617);
    --color-amber-200: oklch(92.4% 0.12 95.746);
    --color-amber-600: oklch(66.6% 0.179 58.318);
    --color-amber-700: oklch(55.5% 0.163 48.998);
    --color-yellow-200: oklch(94.5% 0.129 101.54);
    --color-green-200: oklch(92.5% 0.084 155.995);
    --color-green-600: oklch(62.7% 0.194 149.214);
    --color-green-800: oklch(44.8% 0.119 151.328);
    --color-emerald-50: oklch(97.9% 0.021 166.113);
    --color-emerald-100: oklch(95% 0.052 163.051);
    --color-emerald-600: oklch(59.6% 0.145 163.225);
    --color-emerald-700: oklch(50.8% 0.118 165.612);
    --color-emerald-800: oklch(43.2% 0.095 166.913);
    --color-emerald-900: oklch(37.8% 0.077 168.94);
    --color-blue-50: oklch(97% 0.014 254.604);
    --color-blue-200: oklch(88.2% 0.059 254.128);
    --color-blue-600: oklch(54.6% 0.245 262.881);
    --color-blue-700: oklch(48.8% 0.243 264.376);
    --color-purple-100: oklch(94.6% 0.033 307.174);
    --color-purple-600: oklch(55.8% 0.288 302.321);
    --color-purple-700: oklch(49.6% 0.265 301.924);
    --color-purple-800: oklch(43.8% 0.218 303.724);
    --color-purple-900: oklch(38.1% 0.176 304.987);
    --color-pink-200: oklch(89.9% 0.061 343.231);
    --color-rose-600: oklch(58.6% 0.253 17.585);
    --color-rose-700: oklch(51.4% 0.222 16.935);
    --color-slate-50: oklch(98.4% 0.003 247.858);
    --color-slate-100: oklch(96.8% 0.007 247.896);
    --color-slate-200: oklch(92.9% 0.013 255.508);
    --color-slate-300: oklch(86.9% 0.022 252.894);
    --color-slate-400: oklch(70.4% 0.04 256.788);
    --color-slate-500: oklch(55.4% 0.046 257.417);
    --color-slate-600: oklch(44.6% 0.043 257.281);
    --color-slate-700: oklch(37.2% 0.044 257.287);
    --color-slate-800: oklch(27.9% 0.041 260.031);
    --color-gray-700: oklch(37.3% 0.034 259.733);
    --color-black: #000;
    --color-white: #fff;
    --spacing: 0.25rem;
    --container-md: 28rem;
    --text-xs: 0.75rem;
    --text-xs--line-height: calc(1 / 0.75);
    --text-sm: 0.875rem;
    --text-sm--line-height: calc(1.25 / 0.875);
    --text-base: 1rem;
    --text-base--line-height: calc(1.5 / 1);
    --text-lg: 1.125rem;
    --text-lg--line-height: calc(1.75 / 1.125);
    --text-xl: 1.25rem;
    --text-xl--line-height: calc(1.75 / 1.25);
    --text-2xl: 1.5rem;
    --text-2xl--line-height: calc(2 / 1.5);
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --font-weight-black: 900;
    --tracking-wide: 0.025em;
    --tracking-wider: 0.05em;
    --leading-relaxed: 1.625;
    --ease-out: cubic-bezier(0, 0, 0.2, 1);
    --animate-spin: spin 1s linear infinite;
    --blur-sm: 8px;
    --default-transition-duration: 150ms;
    --default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    --default-font-family: var(--font-sans);
    --default-mono-font-family: var(--font-mono);
    --color-blue-bold: #005AE0;
  }
}
@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0 solid;
  }
  html, :host {
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    -moz-tab-size: 4;
      -o-tab-size: 4;
         tab-size: 4;
    font-family: var(--default-font-family, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");
    font-feature-settings: var(--default-font-feature-settings, normal);
    font-variation-settings: var(--default-font-variation-settings, normal);
    -webkit-tap-highlight-color: transparent;
  }
  hr {
    height: 0;
    color: inherit;
    border-top-width: 1px;
  }
  abbr:where([title]) {
    -webkit-text-decoration: underline dotted;
    text-decoration: underline dotted;
  }
  h1, h2, h3, h4, h5, h6 {
    font-size: inherit;
    font-weight: inherit;
  }
  a {
    color: inherit;
    -webkit-text-decoration: inherit;
    text-decoration: inherit;
  }
  b, strong {
    font-weight: bolder;
  }
  code, kbd, samp, pre {
    font-family: var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
    font-feature-settings: var(--default-mono-font-feature-settings, normal);
    font-variation-settings: var(--default-mono-font-variation-settings, normal);
    font-size: 1em;
  }
  small {
    font-size: 80%;
  }
  sub, sup {
    font-size: 75%;
    line-height: 0;
    position: relative;
    vertical-align: baseline;
  }
  sub {
    bottom: -0.25em;
  }
  sup {
    top: -0.5em;
  }
  table {
    text-indent: 0;
    border-color: inherit;
    border-collapse: collapse;
  }
  :-moz-focusring {
    outline: auto;
  }
  progress {
    vertical-align: baseline;
  }
  summary {
    display: list-item;
  }
  ol, ul, menu {
    list-style: none;
  }
  img, svg, video, canvas, audio, iframe, embed, object {
    display: block;
    vertical-align: middle;
  }
  img, video {
    max-width: 100%;
    height: auto;
  }
  button, input, select, optgroup, textarea, ::file-selector-button {
    font: inherit;
    font-feature-settings: inherit;
    font-variation-settings: inherit;
    letter-spacing: inherit;
    color: inherit;
    border-radius: 0;
    background-color: transparent;
    opacity: 1;
  }
  :where(select:is([multiple], [size])) optgroup {
    font-weight: bolder;
  }
  :where(select:is([multiple], [size])) optgroup option {
    padding-inline-start: 20px;
  }
  ::file-selector-button {
    margin-inline-end: 4px;
  }
  ::-moz-placeholder {
    opacity: 1;
  }
  ::placeholder {
    opacity: 1;
  }
  @supports (not (-webkit-appearance: -apple-pay-button))  or (contain-intrinsic-size: 1px) {
    ::-moz-placeholder {
      color: currentcolor;
      @supports (color: color-mix(in lab, red, red)) {
        color: color-mix(in oklab, currentcolor 50%, transparent);
      }
    }
    ::placeholder {
      color: currentcolor;
      @supports (color: color-mix(in lab, red, red)) {
        color: color-mix(in oklab, currentcolor 50%, transparent);
      }
    }
  }
  textarea {
    resize: vertical;
  }
  ::-webkit-search-decoration {
    -webkit-appearance: none;
  }
  ::-webkit-date-and-time-value {
    min-height: 1lh;
    text-align: inherit;
  }
  ::-webkit-datetime-edit {
    display: inline-flex;
  }
  ::-webkit-datetime-edit-fields-wrapper {
    padding: 0;
  }
  ::-webkit-datetime-edit, ::-webkit-datetime-edit-year-field, ::-webkit-datetime-edit-month-field, ::-webkit-datetime-edit-day-field, ::-webkit-datetime-edit-hour-field, ::-webkit-datetime-edit-minute-field, ::-webkit-datetime-edit-second-field, ::-webkit-datetime-edit-millisecond-field, ::-webkit-datetime-edit-meridiem-field {
    padding-block: 0;
  }
  ::-webkit-calendar-picker-indicator {
    line-height: 1;
  }
  :-moz-ui-invalid {
    box-shadow: none;
  }
  button, input:where([type="button"], [type="reset"], [type="submit"]), ::file-selector-button {
    -webkit-appearance: button;
       -moz-appearance: button;
            appearance: button;
  }
  ::-webkit-inner-spin-button, ::-webkit-outer-spin-button {
    height: auto;
  }
  [hidden]:where(:not([hidden="until-found"])) {
    display: none !important;
  }
}
@layer utilities {
  .pointer-events-auto {
    pointer-events: auto;
  }
  .visible {
    visibility: visible;
  }
  .absolute {
    position: absolute;
  }
  .fixed {
    position: fixed;
  }
  .relative {
    position: relative;
  }
  .static {
    position: static;
  }
  .sticky {
    position: sticky;
  }
  .inset-0 {
    inset: calc(var(--spacing) * 0);
  }
  .top-1 {
    top: calc(var(--spacing) * 1);
  }
  .top-5 {
    top: calc(var(--spacing) * 5);
  }
  .top-full {
    top: 100%;
  }
  .right-1 {
    right: calc(var(--spacing) * 1);
  }
  .right-1\\.5 {
    right: calc(var(--spacing) * 1.5);
  }
  .right-2 {
    right: calc(var(--spacing) * 2);
  }
  .right-5 {
    right: calc(var(--spacing) * 5);
  }
  .bottom-0\\.5 {
    bottom: calc(var(--spacing) * 0.5);
  }
  .bottom-8 {
    bottom: calc(var(--spacing) * 8);
  }
  .bottom-20 {
    bottom: calc(var(--spacing) * 20);
  }
  .bottom-24 {
    bottom: calc(var(--spacing) * 24);
  }
  .left-0 {
    left: calc(var(--spacing) * 0);
  }
  .left-1 {
    left: calc(var(--spacing) * 1);
  }
  .left-1\\.5 {
    left: calc(var(--spacing) * 1.5);
  }
  .left-1\\/2 {
    left: calc(1/2 * 100%);
  }
  .z-10 {
    z-index: 10;
  }
  .z-2147483645 {
    z-index: 2147483645;
  }
  .z-2147483646 {
    z-index: 2147483646;
  }
  .z-2147483647 {
    z-index: 2147483647;
  }
  .z-2147483648 {
    z-index: 2147483648;
  }
  .container {
    width: 100%;
    @media (width >= 40rem) {
      max-width: 40rem;
    }
    @media (width >= 48rem) {
      max-width: 48rem;
    }
    @media (width >= 64rem) {
      max-width: 64rem;
    }
    @media (width >= 80rem) {
      max-width: 80rem;
    }
    @media (width >= 96rem) {
      max-width: 96rem;
    }
  }
  .m-0 {
    margin: calc(var(--spacing) * 0);
  }
  .mx-1 {
    margin-inline: calc(var(--spacing) * 1);
  }
  .mt-1 {
    margin-top: calc(var(--spacing) * 1);
  }
  .mt-4 {
    margin-top: calc(var(--spacing) * 4);
  }
  .mb-1 {
    margin-bottom: calc(var(--spacing) * 1);
  }
  .mb-2 {
    margin-bottom: calc(var(--spacing) * 2);
  }
  .mb-3 {
    margin-bottom: calc(var(--spacing) * 3);
  }
  .mb-4 {
    margin-bottom: calc(var(--spacing) * 4);
  }
  .ml-1 {
    margin-left: calc(var(--spacing) * 1);
  }
  .\\!hidden {
    display: none !important;
  }
  .block {
    display: block;
  }
  .contents {
    display: contents;
  }
  .flex {
    display: flex;
  }
  .hidden {
    display: none;
  }
  .inline {
    display: inline;
  }
  .inline-block {
    display: inline-block;
  }
  .h-0\\.5 {
    height: calc(var(--spacing) * 0.5);
  }
  .h-1\\.5 {
    height: calc(var(--spacing) * 1.5);
  }
  .h-5 {
    height: calc(var(--spacing) * 5);
  }
  .h-6 {
    height: calc(var(--spacing) * 6);
  }
  .h-7 {
    height: calc(var(--spacing) * 7);
  }
  .h-full {
    height: 100%;
  }
  .max-h-\\[120px\\] {
    max-height: 120px;
  }
  .max-h-\\[calc\\(100vh-32px\\)\\] {
    max-height: calc(100vh - 32px);
  }
  .w-5 {
    width: calc(var(--spacing) * 5);
  }
  .w-6 {
    width: calc(var(--spacing) * 6);
  }
  .w-7 {
    width: calc(var(--spacing) * 7);
  }
  .w-28 {
    width: calc(var(--spacing) * 28);
  }
  .w-32 {
    width: calc(var(--spacing) * 32);
  }
  .w-\\[400px\\] {
    width: 400px;
  }
  .w-full {
    width: 100%;
  }
  .w-px {
    width: 1px;
  }
  .max-w-\\[85\\%\\] {
    max-width: 85%;
  }
  .max-w-\\[calc\\(100vw-32px\\)\\] {
    max-width: calc(100vw - 32px);
  }
  .max-w-\\[calc\\(100vw-40px\\)\\] {
    max-width: calc(100vw - 40px);
  }
  .min-w-md {
    min-width: var(--container-md);
  }
  .flex-1 {
    flex: 1;
  }
  .grow {
    flex-grow: 1;
  }
  .-translate-x-1\\/2 {
    --tw-translate-x: calc(calc(1/2 * 100%) * -1);
    translate: var(--tw-translate-x) var(--tw-translate-y);
  }
  .translate-x-0\\.5 {
    --tw-translate-x: calc(var(--spacing) * 0.5);
    translate: var(--tw-translate-x) var(--tw-translate-y);
  }
  .translate-y-0 {
    --tw-translate-y: calc(var(--spacing) * 0);
    translate: var(--tw-translate-x) var(--tw-translate-y);
  }
  .translate-y-0\\.5 {
    --tw-translate-y: calc(var(--spacing) * 0.5);
    translate: var(--tw-translate-x) var(--tw-translate-y);
  }
  .translate-y-2 {
    --tw-translate-y: calc(var(--spacing) * 2);
    translate: var(--tw-translate-x) var(--tw-translate-y);
  }
  .scale-95 {
    --tw-scale-x: 95%;
    --tw-scale-y: 95%;
    --tw-scale-z: 95%;
    scale: var(--tw-scale-x) var(--tw-scale-y);
  }
  .scale-100 {
    --tw-scale-x: 100%;
    --tw-scale-y: 100%;
    --tw-scale-z: 100%;
    scale: var(--tw-scale-x) var(--tw-scale-y);
  }
  .scale-125 {
    --tw-scale-x: 125%;
    --tw-scale-y: 125%;
    --tw-scale-z: 125%;
    scale: var(--tw-scale-x) var(--tw-scale-y);
  }
  .animate-\\[slideIn_0\\.2s_ease\\] {
    animation: slideIn 0.2s ease;
  }
  .animate-spin {
    animation: var(--animate-spin);
  }
  .cursor-not-allowed {
    cursor: not-allowed;
  }
  .cursor-pointer {
    cursor: pointer;
  }
  .resize {
    resize: both;
  }
  .resize-none {
    resize: none;
  }
  .flex-col {
    flex-direction: column;
  }
  .flex-wrap {
    flex-wrap: wrap;
  }
  .items-center {
    align-items: center;
  }
  .justify-between {
    justify-content: space-between;
  }
  .justify-center {
    justify-content: center;
  }
  .justify-end {
    justify-content: flex-end;
  }
  .gap-1 {
    gap: calc(var(--spacing) * 1);
  }
  .gap-1\\.5 {
    gap: calc(var(--spacing) * 1.5);
  }
  .gap-2 {
    gap: calc(var(--spacing) * 2);
  }
  .gap-2\\.5 {
    gap: calc(var(--spacing) * 2.5);
  }
  .gap-3 {
    gap: calc(var(--spacing) * 3);
  }
  .gap-4 {
    gap: calc(var(--spacing) * 4);
  }
  .gap-6 {
    gap: calc(var(--spacing) * 6);
  }
  .self-end {
    align-self: flex-end;
  }
  .self-start {
    align-self: flex-start;
  }
  .overflow-hidden {
    overflow: hidden;
  }
  .overflow-y-auto {
    overflow-y: auto;
  }
  .rounded {
    border-radius: 0.25rem;
  }
  .rounded-full {
    border-radius: calc(infinity * 1px);
  }
  .border {
    border-style: var(--tw-border-style);
    border-width: 1px;
  }
  .border-2 {
    border-style: var(--tw-border-style);
    border-width: 2px;
  }
  .border-4 {
    border-style: var(--tw-border-style);
    border-width: 4px;
  }
  .border-x-2 {
    border-inline-style: var(--tw-border-style);
    border-inline-width: 2px;
  }
  .border-y-4 {
    border-block-style: var(--tw-border-style);
    border-block-width: 4px;
  }
  .border-t-4 {
    border-top-style: var(--tw-border-style);
    border-top-width: 4px;
  }
  .border-r-4 {
    border-right-style: var(--tw-border-style);
    border-right-width: 4px;
  }
  .border-b-2 {
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 2px;
  }
  .border-b-4 {
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 4px;
  }
  .border-l-4 {
    border-left-style: var(--tw-border-style);
    border-left-width: 4px;
  }
  .border-none {
    --tw-border-style: none;
    border-style: none;
  }
  .border-black {
    border-color: var(--color-black);
  }
  .border-blue-bold {
    border-color: var(--color-blue-bold);
  }
  .border-red-300 {
    border-color: var(--color-red-300);
  }
  .border-red-500 {
    border-color: var(--color-red-500);
  }
  .border-red-800 {
    border-color: var(--color-red-800);
  }
  .border-slate-200 {
    border-color: var(--color-slate-200);
  }
  .border-transparent {
    border-color: transparent;
  }
  .border-l-blue-600 {
    border-left-color: var(--color-blue-600);
  }
  .border-l-emerald-600 {
    border-left-color: var(--color-emerald-600);
  }
  .border-l-red-600 {
    border-left-color: var(--color-red-600);
  }
  .bg-amber-100 {
    background-color: var(--color-amber-100);
  }
  .bg-black {
    background-color: var(--color-black);
  }
  .bg-black\\/20 {
    background-color: color-mix(in srgb, #000 20%, transparent);
    @supports (color: color-mix(in lab, red, red)) {
      background-color: color-mix(in oklab, var(--color-black) 20%, transparent);
    }
  }
  .bg-blue-200 {
    background-color: var(--color-blue-200);
  }
  .bg-blue-bold {
    background-color: var(--color-blue-bold);
  }
  .bg-emerald-100 {
    background-color: var(--color-emerald-100);
  }
  .bg-emerald-600 {
    background-color: var(--color-emerald-600);
  }
  .bg-green-200 {
    background-color: var(--color-green-200);
  }
  .bg-green-600 {
    background-color: var(--color-green-600);
  }
  .bg-pink-200 {
    background-color: var(--color-pink-200);
  }
  .bg-purple-100 {
    background-color: var(--color-purple-100);
  }
  .bg-purple-600 {
    background-color: var(--color-purple-600);
  }
  .bg-red-50 {
    background-color: var(--color-red-50);
  }
  .bg-red-100 {
    background-color: var(--color-red-100);
  }
  .bg-red-600 {
    background-color: var(--color-red-600);
  }
  .bg-rose-600 {
    background-color: var(--color-rose-600);
  }
  .bg-slate-100 {
    background-color: var(--color-slate-100);
  }
  .bg-slate-200 {
    background-color: var(--color-slate-200);
  }
  .bg-transparent {
    background-color: transparent;
  }
  .bg-white {
    background-color: var(--color-white);
  }
  .bg-yellow-200 {
    background-color: var(--color-yellow-200);
  }
  .bg-none {
    background-image: none;
  }
  .p-0 {
    padding: calc(var(--spacing) * 0);
  }
  .p-1 {
    padding: calc(var(--spacing) * 1);
  }
  .p-2 {
    padding: calc(var(--spacing) * 2);
  }
  .p-3 {
    padding: calc(var(--spacing) * 3);
  }
  .p-4 {
    padding: calc(var(--spacing) * 4);
  }
  .p-10 {
    padding: calc(var(--spacing) * 10);
  }
  .px-1 {
    padding-inline: calc(var(--spacing) * 1);
  }
  .px-2 {
    padding-inline: calc(var(--spacing) * 2);
  }
  .px-3 {
    padding-inline: calc(var(--spacing) * 3);
  }
  .px-4 {
    padding-inline: calc(var(--spacing) * 4);
  }
  .px-5 {
    padding-inline: calc(var(--spacing) * 5);
  }
  .py-1 {
    padding-block: calc(var(--spacing) * 1);
  }
  .py-1\\.5 {
    padding-block: calc(var(--spacing) * 1.5);
  }
  .py-2 {
    padding-block: calc(var(--spacing) * 2);
  }
  .py-2\\.5 {
    padding-block: calc(var(--spacing) * 2.5);
  }
  .py-3 {
    padding-block: calc(var(--spacing) * 3);
  }
  .py-4 {
    padding-block: calc(var(--spacing) * 4);
  }
  .py-8 {
    padding-block: calc(var(--spacing) * 8);
  }
  .pt-4 {
    padding-top: calc(var(--spacing) * 4);
  }
  .pr-3 {
    padding-right: calc(var(--spacing) * 3);
  }
  .pb-1 {
    padding-bottom: calc(var(--spacing) * 1);
  }
  .pl-5 {
    padding-left: calc(var(--spacing) * 5);
  }
  .text-center {
    text-align: center;
  }
  .text-left {
    text-align: left;
  }
  .font-mono {
    font-family: var(--font-mono);
  }
  .font-sans {
    font-family: var(--font-sans);
  }
  .text-2xl {
    font-size: var(--text-2xl);
    line-height: var(--tw-leading, var(--text-2xl--line-height));
  }
  .text-base {
    font-size: var(--text-base);
    line-height: var(--tw-leading, var(--text-base--line-height));
  }
  .text-lg {
    font-size: var(--text-lg);
    line-height: var(--tw-leading, var(--text-lg--line-height));
  }
  .text-sm {
    font-size: var(--text-sm);
    line-height: var(--tw-leading, var(--text-sm--line-height));
  }
  .text-xl {
    font-size: var(--text-xl);
    line-height: var(--tw-leading, var(--text-xl--line-height));
  }
  .text-xs {
    font-size: var(--text-xs);
    line-height: var(--tw-leading, var(--text-xs--line-height));
  }
  .text-\\[10px\\] {
    font-size: 10px;
  }
  .text-\\[11px\\] {
    font-size: 11px;
  }
  .text-\\[13px\\] {
    font-size: 13px;
  }
  .leading-none {
    --tw-leading: 1;
    line-height: 1;
  }
  .leading-relaxed {
    --tw-leading: var(--leading-relaxed);
    line-height: var(--leading-relaxed);
  }
  .font-black {
    --tw-font-weight: var(--font-weight-black);
    font-weight: var(--font-weight-black);
  }
  .font-bold {
    --tw-font-weight: var(--font-weight-bold);
    font-weight: var(--font-weight-bold);
  }
  .font-medium {
    --tw-font-weight: var(--font-weight-medium);
    font-weight: var(--font-weight-medium);
  }
  .font-normal {
    --tw-font-weight: var(--font-weight-normal);
    font-weight: var(--font-weight-normal);
  }
  .font-semibold {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .tracking-wide {
    --tw-tracking: var(--tracking-wide);
    letter-spacing: var(--tracking-wide);
  }
  .tracking-wider {
    --tw-tracking: var(--tracking-wider);
    letter-spacing: var(--tracking-wider);
  }
  .wrap-break-word {
    overflow-wrap: break-word;
  }
  .text-amber-600 {
    color: var(--color-amber-600);
  }
  .text-amber-700 {
    color: var(--color-amber-700);
  }
  .text-black {
    color: var(--color-black);
  }
  .text-blue-600 {
    color: var(--color-blue-600);
  }
  .text-blue-bold {
    color: var(--color-blue-bold);
  }
  .text-emerald-600 {
    color: var(--color-emerald-600);
  }
  .text-emerald-700 {
    color: var(--color-emerald-700);
  }
  .text-emerald-800 {
    color: var(--color-emerald-800);
  }
  .text-emerald-900 {
    color: var(--color-emerald-900);
  }
  .text-gray-700 {
    color: var(--color-gray-700);
  }
  .text-green-600 {
    color: var(--color-green-600);
  }
  .text-inherit {
    color: inherit;
  }
  .text-orange-600 {
    color: var(--color-orange-600);
  }
  .text-purple-600 {
    color: var(--color-purple-600);
  }
  .text-purple-900 {
    color: var(--color-purple-900);
  }
  .text-red-600 {
    color: var(--color-red-600);
  }
  .text-red-700 {
    color: var(--color-red-700);
  }
  .text-red-800 {
    color: var(--color-red-800);
  }
  .text-rose-600 {
    color: var(--color-rose-600);
  }
  .text-slate-400 {
    color: var(--color-slate-400);
  }
  .text-slate-500 {
    color: var(--color-slate-500);
  }
  .text-slate-600 {
    color: var(--color-slate-600);
  }
  .text-slate-700 {
    color: var(--color-slate-700);
  }
  .text-slate-800 {
    color: var(--color-slate-800);
  }
  .text-white {
    color: var(--color-white);
  }
  .uppercase {
    text-transform: uppercase;
  }
  .italic {
    font-style: italic;
  }
  .not-italic {
    font-style: normal;
  }
  .line-through {
    text-decoration-line: line-through;
  }
  .no-underline {
    text-decoration-line: none;
  }
  .underline {
    text-decoration-line: underline;
  }
  .accent-blue-bold {
    accent-color: var(--color-blue-bold);
  }
  .opacity-0 {
    opacity: 0%;
  }
  .opacity-50 {
    opacity: 50%;
  }
  .opacity-60 {
    opacity: 60%;
  }
  .opacity-70 {
    opacity: 70%;
  }
  .opacity-80 {
    opacity: 80%;
  }
  .opacity-100 {
    opacity: 100%;
  }
  .shadow {
    --tw-shadow: 0 1px 3px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 1px 2px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  }
  .shadow-brutalist-md {
    --tw-shadow: 6px 6px 0px 0px var(--tw-shadow-color, rgba(0, 0, 0, 1));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  }
  .shadow-brutalist-sm {
    --tw-shadow: 4px 4px 0px 0px var(--tw-shadow-color, rgba(0, 0, 0, 1));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  }
  .shadow-none {
    --tw-shadow: 0 0 #0000;
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  }
  .outline {
    outline-style: var(--tw-outline-style);
    outline-width: 1px;
  }
  .blur {
    --tw-blur: blur(8px);
    filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,);
  }
  .filter {
    filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,);
  }
  .backdrop-blur-sm {
    --tw-backdrop-blur: blur(var(--blur-sm));
    backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);
  }
  .transition {
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, backdrop-filter, display, content-visibility, overlay, pointer-events;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .transition-all {
    transition-property: all;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .transition-colors {
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .transition-transform {
    transition-property: transform, translate, scale, rotate;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .duration-200 {
    --tw-duration: 200ms;
    transition-duration: 200ms;
  }
  .duration-300 {
    --tw-duration: 300ms;
    transition-duration: 300ms;
  }
  .ease-out {
    --tw-ease: var(--ease-out);
    transition-timing-function: var(--ease-out);
  }
  .outline-none {
    --tw-outline-style: none;
    outline-style: none;
  }
  .select-none {
    -webkit-user-select: none;
    -moz-user-select: none;
         user-select: none;
  }
  .group-hover\\:text-blue-bold {
    &:is(:where(.group):hover *) {
      @media (hover: hover) {
        color: var(--color-blue-bold);
      }
    }
  }
  .placeholder\\:text-slate-400 {
    &::-moz-placeholder {
      color: var(--color-slate-400);
    }
    &::placeholder {
      color: var(--color-slate-400);
    }
  }
  .hover\\:scale-110 {
    &:hover {
      @media (hover: hover) {
        --tw-scale-x: 110%;
        --tw-scale-y: 110%;
        --tw-scale-z: 110%;
        scale: var(--tw-scale-x) var(--tw-scale-y);
      }
    }
  }
  .hover\\:border-slate-300 {
    &:hover {
      @media (hover: hover) {
        border-color: var(--color-slate-300);
      }
    }
  }
  .hover\\:bg-amber-200 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-amber-200);
      }
    }
  }
  .hover\\:bg-blue-50 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-blue-50);
      }
    }
  }
  .hover\\:bg-blue-700 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-blue-700);
      }
    }
  }
  .hover\\:bg-emerald-50 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-emerald-50);
      }
    }
  }
  .hover\\:bg-emerald-700 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-emerald-700);
      }
    }
  }
  .hover\\:bg-green-800 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-green-800);
      }
    }
  }
  .hover\\:bg-purple-700 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-purple-700);
      }
    }
  }
  .hover\\:bg-purple-800 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-purple-800);
      }
    }
  }
  .hover\\:bg-red-700 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-red-700);
      }
    }
  }
  .hover\\:bg-rose-700 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-rose-700);
      }
    }
  }
  .hover\\:bg-slate-50 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-slate-50);
      }
    }
  }
  .hover\\:bg-slate-100 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-slate-100);
      }
    }
  }
  .hover\\:bg-slate-200 {
    &:hover {
      @media (hover: hover) {
        background-color: var(--color-slate-200);
      }
    }
  }
  .hover\\:text-purple-700 {
    &:hover {
      @media (hover: hover) {
        color: var(--color-purple-700);
      }
    }
  }
  .hover\\:text-slate-200 {
    &:hover {
      @media (hover: hover) {
        color: var(--color-slate-200);
      }
    }
  }
  .focus\\:border-blue-bold {
    &:focus {
      border-color: var(--color-blue-bold);
    }
  }
  .focus\\:bg-blue-50 {
    &:focus {
      background-color: var(--color-blue-50);
    }
  }
  .focus\\:outline-none {
    &:focus {
      --tw-outline-style: none;
      outline-style: none;
    }
  }
  .active\\:translate-x-0\\.5 {
    &:active {
      --tw-translate-x: calc(var(--spacing) * 0.5);
      translate: var(--tw-translate-x) var(--tw-translate-y);
    }
  }
  .active\\:translate-x-px {
    &:active {
      --tw-translate-x: 1px;
      translate: var(--tw-translate-x) var(--tw-translate-y);
    }
  }
  .active\\:translate-y-0\\.5 {
    &:active {
      --tw-translate-y: calc(var(--spacing) * 0.5);
      translate: var(--tw-translate-x) var(--tw-translate-y);
    }
  }
  .active\\:translate-y-px {
    &:active {
      --tw-translate-y: 1px;
      translate: var(--tw-translate-x) var(--tw-translate-y);
    }
  }
  .active\\:shadow-none {
    &:active {
      --tw-shadow: 0 0 #0000;
      box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    }
  }
  .md\\:shadow-brutalist-md {
    @media (width >= 48rem) {
      --tw-shadow: 6px 6px 0px 0px var(--tw-shadow-color, rgba(0, 0, 0, 1));
      box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    }
  }
}
:host {
  all: initial;
}
.cms-root {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.cms-root *,
.cms-root *::before,
.cms-root *::after {
  box-sizing: border-box;
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.spinning {
  animation: spin 1s linear infinite;
}
.slide-in {
  animation: slideIn 0.2s ease;
}
@property --tw-translate-x {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
@property --tw-translate-y {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
@property --tw-translate-z {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
@property --tw-scale-x {
  syntax: "*";
  inherits: false;
  initial-value: 1;
}
@property --tw-scale-y {
  syntax: "*";
  inherits: false;
  initial-value: 1;
}
@property --tw-scale-z {
  syntax: "*";
  inherits: false;
  initial-value: 1;
}
@property --tw-border-style {
  syntax: "*";
  inherits: false;
  initial-value: solid;
}
@property --tw-leading {
  syntax: "*";
  inherits: false;
}
@property --tw-font-weight {
  syntax: "*";
  inherits: false;
}
@property --tw-tracking {
  syntax: "*";
  inherits: false;
}
@property --tw-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-shadow-color {
  syntax: "*";
  inherits: false;
}
@property --tw-shadow-alpha {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-inset-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-inset-shadow-color {
  syntax: "*";
  inherits: false;
}
@property --tw-inset-shadow-alpha {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-ring-color {
  syntax: "*";
  inherits: false;
}
@property --tw-ring-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-inset-ring-color {
  syntax: "*";
  inherits: false;
}
@property --tw-inset-ring-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-ring-inset {
  syntax: "*";
  inherits: false;
}
@property --tw-ring-offset-width {
  syntax: "<length>";
  inherits: false;
  initial-value: 0px;
}
@property --tw-ring-offset-color {
  syntax: "*";
  inherits: false;
  initial-value: #fff;
}
@property --tw-ring-offset-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-outline-style {
  syntax: "*";
  inherits: false;
  initial-value: solid;
}
@property --tw-blur {
  syntax: "*";
  inherits: false;
}
@property --tw-brightness {
  syntax: "*";
  inherits: false;
}
@property --tw-contrast {
  syntax: "*";
  inherits: false;
}
@property --tw-grayscale {
  syntax: "*";
  inherits: false;
}
@property --tw-hue-rotate {
  syntax: "*";
  inherits: false;
}
@property --tw-invert {
  syntax: "*";
  inherits: false;
}
@property --tw-opacity {
  syntax: "*";
  inherits: false;
}
@property --tw-saturate {
  syntax: "*";
  inherits: false;
}
@property --tw-sepia {
  syntax: "*";
  inherits: false;
}
@property --tw-drop-shadow {
  syntax: "*";
  inherits: false;
}
@property --tw-drop-shadow-color {
  syntax: "*";
  inherits: false;
}
@property --tw-drop-shadow-alpha {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-drop-shadow-size {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-blur {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-brightness {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-contrast {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-grayscale {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-hue-rotate {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-invert {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-opacity {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-saturate {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-sepia {
  syntax: "*";
  inherits: false;
}
@property --tw-duration {
  syntax: "*";
  inherits: false;
}
@property --tw-ease {
  syntax: "*";
  inherits: false;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@layer properties {
  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {
    *, ::before, ::after, ::backdrop {
      --tw-translate-x: 0;
      --tw-translate-y: 0;
      --tw-translate-z: 0;
      --tw-scale-x: 1;
      --tw-scale-y: 1;
      --tw-scale-z: 1;
      --tw-border-style: solid;
      --tw-leading: initial;
      --tw-font-weight: initial;
      --tw-tracking: initial;
      --tw-shadow: 0 0 #0000;
      --tw-shadow-color: initial;
      --tw-shadow-alpha: 100%;
      --tw-inset-shadow: 0 0 #0000;
      --tw-inset-shadow-color: initial;
      --tw-inset-shadow-alpha: 100%;
      --tw-ring-color: initial;
      --tw-ring-shadow: 0 0 #0000;
      --tw-inset-ring-color: initial;
      --tw-inset-ring-shadow: 0 0 #0000;
      --tw-ring-inset: initial;
      --tw-ring-offset-width: 0px;
      --tw-ring-offset-color: #fff;
      --tw-ring-offset-shadow: 0 0 #0000;
      --tw-outline-style: solid;
      --tw-blur: initial;
      --tw-brightness: initial;
      --tw-contrast: initial;
      --tw-grayscale: initial;
      --tw-hue-rotate: initial;
      --tw-invert: initial;
      --tw-opacity: initial;
      --tw-saturate: initial;
      --tw-sepia: initial;
      --tw-drop-shadow: initial;
      --tw-drop-shadow-color: initial;
      --tw-drop-shadow-alpha: 100%;
      --tw-drop-shadow-size: initial;
      --tw-backdrop-blur: initial;
      --tw-backdrop-brightness: initial;
      --tw-backdrop-contrast: initial;
      --tw-backdrop-grayscale: initial;
      --tw-backdrop-hue-rotate: initial;
      --tw-backdrop-invert: initial;
      --tw-backdrop-opacity: initial;
      --tw-backdrop-saturate: initial;
      --tw-backdrop-sepia: initial;
      --tw-duration: initial;
      --tw-ease: initial;
    }
  }
}
`;function U1(w){let v=w.composedPath(),z=document.querySelector(M.HIGHLIGHT_ELEMENT);for(let b of v){if(b===z)return!0;if(b instanceof HTMLElement){if(b.tagName?.startsWith("CMS-"))return!0;if(b.hasAttribute?.(M.UI_ATTRIBUTE))return!0}}return!1}function A1(w){let[v,z]=f({visible:!1,rect:null,isComponent:!1,componentName:void 0,tagName:void 0,element:null}),b=s(0),J=s(null);return D(()=>{if(!v.visible||!v.element)return;let Q=()=>{if(v.element&&document.contains(v.element))z((Z)=>({...Z,rect:v.element.getBoundingClientRect()}));else z((Z)=>({...Z,visible:!1,element:null}))};return window.addEventListener("scroll",Q,!0),window.addEventListener("resize",Q),()=>{window.removeEventListener("scroll",Q,!0),window.removeEventListener("resize",Q)}},[v.visible,v.element]),D(()=>{let Q=(Z)=>{if(!v0.value){z((F)=>({...F,visible:!1}));return}if(U1(Z)){z((F)=>({...F,visible:!1}));return}let K=Date.now();if(K-b.current<X0.ELEMENT_DETECTION_THROTTLE_MS)return;b.current=K;let $=z0.value,G=$.entries,Y=_1(Z.clientX,Z.clientY,G);if(Y&&!Y.hasAttribute(M.COMPONENT_ID_ATTRIBUTE)){let F=Y.getBoundingClientRect();z({visible:!0,rect:F,isComponent:!1,componentName:void 0,tagName:void 0,element:Y}),J.current=Y;return}let k=W1(Z.clientX,Z.clientY);if(k){let F=k.getBoundingClientRect(),x=x1(Z.clientX,Z.clientY,F,P0.COMPONENT_EDGE_THRESHOLD);if(Z.altKey||x){let H=k.getAttribute(M.COMPONENT_ID_ATTRIBUTE),_=H?E0($,H):null;z({visible:!0,rect:F,isComponent:!0,componentName:_?.componentName,tagName:k.tagName.toLowerCase(),element:k}),J.current=k;return}}z({visible:!1,rect:null,isComponent:!1,componentName:void 0,tagName:void 0,element:null}),J.current=null};return document.addEventListener("mousemove",Q,!0),()=>document.removeEventListener("mousemove",Q,!0)},[]),v}function M1({onComponentSelect:w}){D(()=>{let v=(z)=>{if(!v0.value)return;if(U1(z))return;let Q=z0.value.entries,Z=_1(z.clientX,z.clientY,Q);if(Z&&!Z.hasAttribute(M.COMPONENT_ID_ATTRIBUTE))return;let X=W1(z.clientX,z.clientY);if(X){let K=X.getBoundingClientRect(),$=x1(z.clientX,z.clientY,K,P0.COMPONENT_EDGE_THRESHOLD);if(z.altKey||$){let G=X.getAttribute(M.COMPONENT_ID_ATTRIBUTE);if(G)z.preventDefault(),z.stopPropagation(),w(G,K)}}};return document.addEventListener("click",v,!0),()=>document.removeEventListener("click",v,!0)},[w])}function n1(w){let[v,z]=f({elementId:null,rect:null,element:null}),b=h(()=>{let Q=q0.value,Z=d0.value;if(!Q||Z){z({elementId:null,rect:null,element:null});return}let X=G0(Q);if(!X){z({elementId:null,rect:null,element:null});return}z({elementId:Q,rect:X.element.getBoundingClientRect(),element:X.element})},[]),J=h(()=>{z({elementId:null,rect:null,element:null})},[]);return D(()=>{if(!v.elementId||!v.element)return;let Q=()=>{if(v.element&&document.contains(v.element))z((X)=>({...X,rect:v.element.getBoundingClientRect()}));else z({elementId:null,rect:null,element:null})},Z=(X)=>{let K=X.composedPath(),$=K[0];if(v.element?.contains($)||v.element===$)return;let G=document.querySelector(M.HIGHLIGHT_ELEMENT);for(let Y of K){if(Y===G)return;if(Y instanceof HTMLElement){if(Y.tagName?.startsWith("CMS-"))return;if(Y.hasAttribute?.(M.UI_ATTRIBUTE))return}}if($.hasAttribute?.(M.ID_ATTRIBUTE))return;z({elementId:null,rect:null,element:null})};return window.addEventListener("scroll",Q,!0),window.addEventListener("resize",Q),document.addEventListener("mousedown",Z,!0),()=>{window.removeEventListener("scroll",Q,!0),window.removeEventListener("resize",Q),document.removeEventListener("mousedown",Z,!0)}},[v.elementId,v.element]),{tooltipState:v,showTooltipForElement:b,hideTooltip:J}}function b6(w){return{endpoint:`${w.apiBase}/ai`,connectionType:"sse",headers:{"Content-Type":"application/json"}}}class R1{config;aiConfig;abortController=null;websocket=null;constructor(w){this.config=w,this.aiConfig=b6(w)}async streamRequest(w,v){if(this.aiConfig.connectionType==="websocket")return this.streamViaWebSocket(w,v);return this.streamViaSSE(w,v)}async streamViaSSE(w,v){this.abortController=new AbortController;let z=setTimeout(()=>{this.abortController?.abort()},Mw.AI_STREAM_TIMEOUT_MS);v.onStart?.();try{let b=await fetch(`${this.aiConfig.endpoint}/stream`,{method:"POST",headers:this.aiConfig.headers,body:JSON.stringify(w),signal:this.abortController.signal});if(!b.ok)throw Error(`AI request failed: ${b.status} ${b.statusText}`);if(!b.body)throw Error("No response body");let J=b.body.getReader(),Q=new TextDecoder,Z="";while(!0){let{done:X,value:K}=await J.read();if(X)break;let G=Q.decode(K,{stream:!0}).split(`
`);for(let Y of G)if(Y.startsWith("data: ")){let k=Y.slice(6);if(k==="[DONE]"){v.onComplete?.(Z);return}try{let F=JSON.parse(k);if(F.token)Z+=F.token,v.onToken?.(F.token,Z);if(F.error)throw Error(F.error)}catch(F){if(k&&k!=="")Z+=k,v.onToken?.(k,Z)}}}v.onComplete?.(Z)}catch(b){if(b instanceof Error&&b.name==="AbortError"){V(this.config.debug,"AI request aborted or timed out"),v.onError?.(Error("AI request timed out"));return}v.onError?.(b instanceof Error?b:Error(String(b)))}finally{clearTimeout(z),this.abortController=null}}streamViaWebSocket(w,v){return new Promise((z,b)=>{let J=this.aiConfig.endpoint.replace(/^http/,"ws")+"/ws";try{this.websocket=new WebSocket(J);let Q="";this.websocket.onopen=()=>{V(this.config.debug,"WebSocket connected"),v.onStart?.(),this.websocket?.send(JSON.stringify(w))},this.websocket.onmessage=(Z)=>{try{let X=JSON.parse(Z.data);if(X.type==="token")Q+=X.token,v.onToken?.(X.token,Q);else if(X.type==="complete")v.onComplete?.(Q),this.websocket?.close(),z();else if(X.type==="error"){let K=Error(X.message||"AI request failed");v.onError?.(K),this.websocket?.close(),b(K)}}catch(X){Q+=Z.data,v.onToken?.(Z.data,Q)}},this.websocket.onerror=(Z)=>{let X=Error("WebSocket error");v.onError?.(X),b(X)},this.websocket.onclose=()=>{if(V(this.config.debug,"WebSocket closed"),Q)v.onComplete?.(Q);z()}}catch(Q){v.onError?.(Q instanceof Error?Q:Error(String(Q))),b(Q)}})}abort(){if(this.abortController)this.abortController.abort(),this.abortController=null;if(this.websocket)this.websocket.close(),this.websocket=null}setConnectionType(w){this.aiConfig.connectionType=w}isStreaming(){return this.abortController!==null||this.websocket!==null&&this.websocket.readyState===WebSocket.OPEN}async generateBlockProps(w){try{let v=await fetch(`${this.aiConfig.endpoint}/generate-props`,{method:"POST",headers:this.aiConfig.headers,body:JSON.stringify({prompt:w.prompt,componentName:w.componentName,props:w.props,currentValues:w.currentValues,context:w.context})});if(!v.ok)throw Error(`AI request failed: ${v.status} ${v.statusText}`);return(await v.json()).props||{}}catch(v){throw V(this.config.debug,"AI generateBlockProps error:",v),v}}async suggestComponent(w,v){try{let z=await fetch(`${this.aiConfig.endpoint}/suggest-component`,{method:"POST",headers:this.aiConfig.headers,body:JSON.stringify({prompt:w,availableComponents:v})});if(!z.ok)throw Error(`AI request failed: ${z.status} ${z.statusText}`);return(await z.json()).suggestion||null}catch(z){throw V(this.config.debug,"AI suggestComponent error:",z),z}}}function P1({config:w,showToast:v,onTooltipHide:z,onUIUpdate:b}){let J=D0(()=>new R1(w),[w]),Q=h(()=>{if(Z0.value)Lw(!1);else{Lw(!0);let Y=q0.value;if(Y)ww(Y)}},[]),Z=h(()=>{Lw(!1)},[]),X=h(async(Y,k)=>{let F=G0(k);if(!F){v("Element not found","error");return}let x=c0(F.element),H=z0.value;_0(!0),V(w.debug,"Tooltip AI request for element:",k,"prompt:",Y);try{await J.streamRequest({prompt:Y,elementId:k,currentContent:x,context:Z1(H,k)?.file},{onToken:(_,O)=>{F.element.textContent=O},onComplete:(_)=>{V(w.debug,"Tooltip AI completed:",_),F.element.textContent=_,jw(w,k,F.element,b),_0(!1),z(),v("AI edit applied","success")},onError:(_)=>{V(w.debug,"Tooltip AI error:",_),_0(!1),v(`AI error: ${_.message}`,"error")}})}catch(_){_0(!1),v("AI request failed","error")}},[w,J,v,z,b]),K=h(async(Y,k)=>{let F={id:`user-${Date.now()}`,role:"user",content:Y,elementId:k,timestamp:Date.now()};Uw(F);let x=`assistant-${Date.now()}`,H={id:x,role:"assistant",content:"",elementId:k,timestamp:Date.now()};_0(!0);let _=k?G0(k):null,O=_?c0(_.element):void 0,W=z0.value;try{let A=!1;await J.streamRequest({prompt:Y,elementId:k||"",currentContent:O||"",context:k?Z1(W,k)?.file:void 0},{onStart:()=>{if(!A)Uw(H),A=!0},onToken:(R,T)=>{if(!A)Uw(H),A=!0;Aw(x,T)},onComplete:(R)=>{Aw(x,R),_0(!1)},onError:(R)=>{Aw(x,`Error: ${R.message}`),_0(!1),v(`AI error: ${R.message}`,"error")}})}catch(A){_0(!1),v("AI request failed","error")}},[w,J,v]),$=h((Y,k)=>{let F=G0(k);if(!F){v("Element not found","error");return}F.element.textContent=Y,jw(w,k,F.element,b),v("Content applied to element","success")},[w,v,b]),G=h(async(Y,k)=>{let F=z0.value,x=E0(F,Y);if(!x)return v("Component not found","error"),{};let H=Rw(F,x.componentName);if(!H)return v("Component definition not found","error"),{};try{let _=await J.generateBlockProps({prompt:k,componentName:x.componentName,props:H.props,currentValues:x.props});return v("AI filled props","success"),_}catch(_){return V(w.debug,"AI fill props error:",_),v("AI request failed","error"),x.props||{}}},[w,J,v]);return{aiService:J,handleAIChatToggle:Q,handleChatClose:Z,handleTooltipPromptSubmit:X,handleChatSend:K,handleApplyToElement:$,handleAIFillProps:G}}function V1({config:w,showToast:v}){let[z,b]=f(null),J=h(($,G)=>{b1($),Q1(!0),b(G)},[]),Q=h(()=>{Q1(!1),b1(null),b(null)},[]),Z=h(($,G)=>{V(w.debug,"Update props for component:",$,G),v("Props updated (preview only)","info")},[w.debug,v]),X=h(async($,G,Y,k)=>{V(w.debug,"Insert component:",Y,$,G,"props:",k);let F=document.querySelector(`[data-cms-component-id="${G}"]`);if(!F){v("Reference component not found","error");return}let x=`preview-${Date.now()}`,H=document.createElement("div");if(H.setAttribute("data-cms-preview-id",x),H.style.cssText=`
        padding: 24px;
        margin: 8px 0;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        border: 2px dashed #22c55e;
        border-radius: 8px;
        text-align: center;
        font-family: system-ui, -apple-system, sans-serif;
      `,H.innerHTML=`
        <div style="font-weight: 600; color: #16a34a; margin-bottom: 8px;">
          ✓ New ${Y} Component
        </div>
        <div style="font-size: 13px; color: #15803d;">
          ${Object.entries(k).map(([_,O])=>`${_}: "${O}"`).join(", ")||"No props set"}
        </div>
        <div style="font-size: 12px; color: #86efac; margin-top: 8px;">
          Saving changes...
        </div>
      `,$==="before")F.parentNode?.insertBefore(H,F);else F.parentNode?.insertBefore(H,F.nextSibling);try{let _=await fetch(`${w.apiBase}/insert-component`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({position:$,referenceComponentId:G,componentName:Y,props:k})});if(!_.ok){let W=await _.text();throw Error(W||"Failed to insert component")}let O=await _.json();H.innerHTML=`
          <div style="font-weight: 600; color: #16a34a; margin-bottom: 8px;">
            ✓ ${Y} inserted successfully!
          </div>
          <div style="font-size: 13px; color: #15803d;">
            Refresh the page to see the actual component.
          </div>
        `,v(`${Y} inserted ${$} component`,"success"),setTimeout(()=>{H.remove()},X0.PREVIEW_SUCCESS_DURATION_MS)}catch(_){console.error("[CMS] Failed to insert component:",_),H.style.background="linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)",H.style.borderColor="#ef4444",H.innerHTML=`
          <div style="font-weight: 600; color: #dc2626; margin-bottom: 8px;">
            ✗ Failed to insert component
          </div>
          <div style="font-size: 13px; color: #991b1b;">
            ${_ instanceof Error?_.message:"Unknown error"}
          </div>
        `,v("Failed to insert component","error"),setTimeout(()=>{H.remove()},X0.PREVIEW_ERROR_DURATION_MS)}},[w.apiBase,w.debug,v]),K=h(($)=>{V(w.debug,"Remove block:",$),v("Block removed (preview only)","info")},[w.debug,v]);return{blockEditorRect:z,handleComponentSelect:J,handleBlockEditorClose:Q,handleUpdateProps:Z,handleInsertComponent:X,handleRemoveBlock:K}}function T1(){let[w,v]=f({hasSelection:!1,selection:null,rect:null,element:null});return D(()=>{let z=()=>{if(!v0.value){v({hasSelection:!1,selection:null,rect:null,element:null});return}let X=window.getSelection();if(!X||X.isCollapsed||X.rangeCount===0){v({hasSelection:!1,selection:null,rect:null,element:null});return}let K=X.getRangeAt(0),$=K.commonAncestorContainer,G=$.nodeType===Node.TEXT_NODE?$.parentElement:$,Y=null;while(G&&G!==document.body){if(G.hasAttribute(M.ID_ATTRIBUTE)&&G.contentEditable==="true"){Y=G;break}G=G.parentElement}if(!Y){v({hasSelection:!1,selection:null,rect:null,element:null});return}let k=Jw(Y);if(!k){v({hasSelection:!1,selection:null,rect:null,element:null});return}let F=K.getBoundingClientRect();v({hasSelection:!0,selection:k,rect:F,element:Y})},b=null,J=()=>{if(b)clearTimeout(b);b=window.setTimeout(z,50)};document.addEventListener("selectionchange",J);let Q=(Z)=>{let X=Z.target;if(X.hasAttribute?.(M.UI_ATTRIBUTE)||X.closest?.(`[${M.UI_ATTRIBUTE}]`))return;setTimeout(z,10)};return document.addEventListener("mouseup",Q),()=>{if(document.removeEventListener("selectionchange",J),document.removeEventListener("mouseup",Q),b)clearTimeout(b)}},[]),D(()=>{if(!w.hasSelection)return;let z=()=>{let b=window.getSelection();if(b&&b.rangeCount>0){let Q=b.getRangeAt(0).getBoundingClientRect();v((Z)=>({...Z,rect:Q}))}};return window.addEventListener("scroll",z,!0),window.addEventListener("resize",z),()=>{window.removeEventListener("scroll",z,!0),window.removeEventListener("resize",z)}},[w.hasSelection]),w}var J6=()=>{let w=ew.value,v=A1(),z=T1(),{tooltipState:b,showTooltipForElement:J,hideTooltip:Q}=n1(),Z=h(()=>{J()},[J]),{handleAIChatToggle:X,handleChatClose:K,handleTooltipPromptSubmit:$,handleChatSend:G,handleApplyToElement:Y,handleAIFillProps:k}=P1({config:w,showToast:r0,onTooltipHide:Q,onUIUpdate:Z}),{blockEditorRect:F,handleComponentSelect:x,handleBlockEditorClose:H,handleUpdateProps:_,handleInsertComponent:O,handleRemoveBlock:W}=V1({config:w,showToast:r0});M1({onComponentSelect:x});let A=h(async()=>{if(v0.value)Q(),L1(Z);else await M5(w,Z)},[w,Z,Q]),R=h(()=>{n5(w,Z)},[w,Z]),T=h(async()=>{try{let d=await P5(w,Z);if(d.success)r0(`Saved ${d.updated} change(s) successfully!`,"success");else if(d.errors)r0(`Saved ${d.updated}, ${d.errors.length} failed`,"error")}catch(d){r0("Save failed – see console","error")}},[w,Z]),U=h(()=>{R5(Z),r0("All changes discarded","info")},[Z]),S=v0.value,N=d0.value,p=Z0.value,J0=y0.value,i=p0.value;return q(l,{children:[q(O0,{componentName:"Outline",children:q(j2,{visible:v.visible,rect:v.rect,isComponent:v.isComponent,componentName:v.componentName,tagName:v.tagName,element:v.element},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(O0,{componentName:"Toolbar",children:q(Y5,{callbacks:{onEdit:A,onCompare:R,onSave:T,onDiscard:U,onAIChat:X}},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(O0,{componentName:"AI Tooltip",children:q(n2,{callbacks:{onPromptSubmit:$},visible:!!b.elementId&&S&&!N&&!z.hasSelection,elementId:b.elementId,rect:b.rect,processing:N},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(O0,{componentName:"Text Style Toolbar",children:q(X5,{visible:z.hasSelection&&S&&!N,rect:z.rect,element:z.element,onStyleChange:Z},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(O0,{componentName:"AI Chat",children:q(M2,{callbacks:{onSend:G,onClose:K,onApplyToElement:Y}},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(O0,{componentName:"Block Editor",children:q(f2,{visible:J0.isOpen&&S,componentId:J0.currentComponentId,rect:F,onClose:H,onUpdateProps:_,onInsertComponent:O,onRemoveBlock:W,onAIFillProps:k},void 0,!1,void 0,this)},void 0,!1,void 0,this),q(K5,{toasts:i,onRemove:U2},void 0,!1,void 0,this)]},void 0,!0,void 0,this)};class f1{appRoot=null;shadowRoot=null;config=Nw();async init(){A2(this.config),V(this.config.debug,"Initializing CMS editor with config:",this.config),this.setupUI(),this.setupKeyboardShortcuts()}setupUI(){let w=document.createElement("div");w.id="cms-app-host",w.style.cssText="position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;",document.body.appendChild(w);let v=document.createElement("div");v.id="cms-text-styling-safelist",v.innerHTML=Q5,document.body.appendChild(v),this.shadowRoot=w.attachShadow({mode:"open"});let z=document.createElement("style");z.textContent=V5,this.shadowRoot.appendChild(z),this.appRoot=document.createElement("div"),this.appRoot.id="cms-app-root",this.appRoot.className="cms-root",this.shadowRoot.appendChild(this.appRoot),t1(q(J6,{},void 0,!1,void 0,this),this.appRoot)}setupKeyboardShortcuts(){document.addEventListener("keydown",(w)=>{if(!((w.metaKey||w.ctrlKey)&&w.shiftKey&&w.key.toLowerCase()==="e"))return;w.preventDefault(),this.toggleVisibility()})}toggleVisibility(){if(!this.appRoot)return;let w=this.appRoot.style.display==="none";this.appRoot.style.display=w?"block":"none",r0(w?"CMS editing enabled":"CMS editing disabled","info")}}if(typeof window<"u"){let w=()=>{new f1().init()};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",w);else w()}})();

//# debugId=C75FDE1A3B05B65364756E2164756E21
