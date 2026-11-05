import{aH as V,aI as K,aJ as X}from"./index-D3IgogBN.js";import{cs as b,ac as W,b6 as z,W as d,al as F,P as D,Q as M,eV as w,aa as T,af as I,c4 as Y,ay as j,V as k,c6 as q,c7 as $,am as Q,ag as N}from"./index-ymQalFtf.js";class J{_isUbo(e){return e.addUniform!==void 0}constructor(e){this._isUbo(e)?(this.setMatrix3x3=e.updateMatrix3x3.bind(e),this.setMatrix2x2=e.updateMatrix2x2.bind(e),this.setFloat=e.updateFloat.bind(e),this.setFloat2=e.updateFloat2.bind(e),this.setFloat3=e.updateFloat3.bind(e),this.setFloat4=e.updateFloat4.bind(e),this.setFloatArray=e.updateFloatArray.bind(e),this.setArray=e.updateArray.bind(e),this.setIntArray=e.updateIntArray.bind(e),this.setMatrix=e.updateMatrix.bind(e),this.setMatrices=e.updateMatrices.bind(e),this.setVector3=e.updateVector3.bind(e),this.setVector4=e.updateVector4.bind(e),this.setColor3=e.updateColor3.bind(e),this.setColor4=e.updateColor4.bind(e),this.setDirectColor4=e.updateDirectColor4.bind(e),this.setInt=e.updateInt.bind(e),this.setInt2=e.updateInt2.bind(e),this.setInt3=e.updateInt3.bind(e),this.setInt4=e.updateInt4.bind(e)):(this.setMatrix3x3=e.setMatrix3x3.bind(e),this.setMatrix2x2=e.setMatrix2x2.bind(e),this.setFloat=e.setFloat.bind(e),this.setFloat2=e.setFloat2.bind(e),this.setFloat3=e.setFloat3.bind(e),this.setFloat4=e.setFloat4.bind(e),this.setFloatArray=e.setFloatArray.bind(e),this.setArray=e.setArray.bind(e),this.setIntArray=e.setIntArray.bind(e),this.setMatrix=e.setMatrix.bind(e),this.setMatrices=e.setMatrices.bind(e),this.setVector3=e.setVector3.bind(e),this.setVector4=e.setVector4.bind(e),this.setColor3=e.setColor3.bind(e),this.setColor4=e.setColor4.bind(e),this.setDirectColor4=e.setDirectColor4.bind(e),this.setInt=e.setInt.bind(e),this.setInt2=e.setInt2.bind(e),this.setInt3=e.setInt3.bind(e),this.setInt4=e.setInt4.bind(e))}}var fe=!0;let O=!1;function ee(){O||(O=!0,b.prototype.createTransformFeedback=function(){const o=this._gl.createTransformFeedback();if(!o)throw new Error("Unable to create Transform Feedback");return o},b.prototype.deleteTransformFeedback=function(o){this._gl.deleteTransformFeedback(o)},b.prototype.bindTransformFeedback=function(o){this._gl.bindTransformFeedback(this._gl.TRANSFORM_FEEDBACK,o)},b.prototype.beginTransformFeedback=function(o=!0){this._gl.beginTransformFeedback(o?this._gl.POINTS:this._gl.TRIANGLES)},b.prototype.endTransformFeedback=function(){this._gl.endTransformFeedback()},b.prototype.setTranformFeedbackVaryings=function(o,e){this._gl.transformFeedbackVaryings(o,e,this._gl.INTERLEAVED_ATTRIBS)},b.prototype.bindTransformFeedbackBuffer=function(o){this._gl.bindBufferBase(this._gl.TRANSFORM_FEEDBACK_BUFFER,0,o?o.underlyingResource:null)},b.prototype.readTransformFeedbackBuffer=function(o){this._gl.getBufferSubData(this._gl.TRANSFORM_FEEDBACK_BUFFER,0,o)})}class te{constructor(e,s){this._renderVAO=[],this._renderVAOEffects=[],this._updateVAO=[],this._renderVertexBuffers=[],this.alignDataInBuffer=!1,ee(),this._parent=e,this._engine=s,this._updateEffectOptions={attributes:["position","initialPosition","age","life","seed","size","color","direction","initialDirection","angle","cellIndex","cellStartOffset","noiseCoordinates1","noiseCoordinates2"],uniformsNames:["currentCount","timeDelta","emitterWM","lifeTime","color1","color2","sizeRange","scaleRange","gravity","emitPower","direction1","direction2","minEmitBox","maxEmitBox","radius","directionRandomizer","height","coneAngle","stopFactor","emitIndex","emitCount","angleRange","radiusRange","cellInfos","noiseStrength","limitVelocityDamping","flowMapProjection","flowMapStrength"],uniformBuffersNames:[],samplers:["randomSampler","randomSampler2","sizeGradientSampler","angularSpeedGradientSampler","velocityGradientSampler","limitVelocityGradientSampler","noiseSampler","dragGradientSampler","flowMapSampler","meshPositionSampler","meshNormalSampler"],defines:"",fallbacks:null,onCompiled:null,onError:null,indexParameters:null,maxSimultaneousLights:0,transformFeedbackVaryings:[]},this._baseUniformsNamesLength=this._updateEffectOptions.uniformsNames.length}contextLost(){this._updateEffect=void 0,this._renderVAO.length=0,this._renderVAOEffects.length=0,this._updateVAO.length=0,this._renderVertexBuffers.length=0}isUpdateBufferCreated(){return!!this._updateEffect}isUpdateBufferReady(){return this._updateEffect?.isReady()??!1}createUpdateBuffer(e){if(this._updateEffectOptions.uniformsNames.length=this._baseUniformsNamesLength,this._updateEffectOptions.transformFeedbackVaryings=["outPosition"],this._updateEffectOptions.transformFeedbackVaryings.push("outAge"),this._updateEffectOptions.transformFeedbackVaryings.push("outSize"),this._updateEffectOptions.transformFeedbackVaryings.push("outLife"),this._updateEffectOptions.transformFeedbackVaryings.push("outSeed"),this._updateEffectOptions.transformFeedbackVaryings.push("outDirection"),this._parent.particleEmitterType instanceof V&&this._updateEffectOptions.transformFeedbackVaryings.push("outInitialPosition"),this._parent._colorGradientsTexture||this._updateEffectOptions.transformFeedbackVaryings.push("outColor"),this._parent._needsInitialDirection&&this._updateEffectOptions.transformFeedbackVaryings.push("outInitialDirection"),this._parent.noiseTexture&&(this._updateEffectOptions.transformFeedbackVaryings.push("outNoiseCoordinates1"),this._updateEffectOptions.transformFeedbackVaryings.push("outNoiseCoordinates2")),this._updateEffectOptions.transformFeedbackVaryings.push("outAngle"),this._parent.isAnimationSheetEnabled&&(this._updateEffectOptions.transformFeedbackVaryings.push("outCellIndex"),this._parent.spriteRandomStartCell&&this._updateEffectOptions.transformFeedbackVaryings.push("outCellStartOffset")),this._updateEffectOptions.defines=e,e.indexOf("ATTRACTORS")!==-1){this._updateEffectOptions.uniformsNames.push("attractorCount");for(let s=0;s<this._parent.maxAttractors;s++)this._updateEffectOptions.uniformsNames.push("attractorPositionAndStrength["+s+"]")}return e.indexOf("STARTSIZEGRADIENTS")!==-1&&this._updateEffectOptions.uniformsNames.push("startSizeGradientFactor"),e.indexOf("LIFETIMEGRADIENTS")!==-1&&this._updateEffectOptions.uniformsNames.push("lifeTimeGradientRange"),e.indexOf("MESHEMITTER")!==-1&&(this._updateEffectOptions.uniformsNames.push("meshTriangleCount"),this._updateEffectOptions.uniformsNames.push("meshTextureWidth")),this._updateEffect=this._engine.createEffect("gpuUpdateParticles",this._updateEffectOptions,this._engine),new J(this._updateEffect)}createVertexBuffers(e,s){this._updateVAO.push(this._createUpdateVAO(e));const a=this._parent._getWrapper(this._parent.blendMode).effect;this._renderVAO.push(this._engine.recordVertexArrayObject(s,null,a)),this._renderVAOEffects.push(a),this._engine.bindArrayBuffer(null),this._renderVertexBuffers.push(s)}createParticleBuffer(e){return e}bindDrawBuffers(e,s,a){a||this._renderVAOEffects[e]!==s?this._engine.bindBuffers(this._renderVertexBuffers[e],a,s):this._engine.bindVertexArrayObject(this._renderVAO[e],null)}preUpdateParticleBuffer(){const e=this._engine;if(this._engine.enableEffect(this._updateEffect),!e.setState)throw new Error("GPU particles cannot work without a full Engine. ThinEngine is not supported")}updateParticleBuffer(e,s,a){this._updateEffect.setTexture("randomSampler",this._parent._randomTexture),this._updateEffect.setTexture("randomSampler2",this._parent._randomTexture2),this._parent._flowMap&&this._updateEffect.setTexture("flowMapSampler",this._parent._flowMap),this._parent._sizeGradientsTexture&&this._updateEffect.setTexture("sizeGradientSampler",this._parent._sizeGradientsTexture),this._parent._angularSpeedGradientsTexture&&this._updateEffect.setTexture("angularSpeedGradientSampler",this._parent._angularSpeedGradientsTexture),this._parent._velocityGradientsTexture&&this._updateEffect.setTexture("velocityGradientSampler",this._parent._velocityGradientsTexture),this._parent._limitVelocityGradientsTexture&&this._updateEffect.setTexture("limitVelocityGradientSampler",this._parent._limitVelocityGradientsTexture),this._parent._dragGradientsTexture&&this._updateEffect.setTexture("dragGradientSampler",this._parent._dragGradientsTexture),this._parent.noiseTexture&&this._updateEffect.setTexture("noiseSampler",this._parent.noiseTexture),this._parent._meshPositionTexture&&this._updateEffect.setTexture("meshPositionSampler",this._parent._meshPositionTexture),this._parent._meshNormalTexture&&this._updateEffect.setTexture("meshNormalSampler",this._parent._meshNormalTexture),this._engine.bindVertexArrayObject(this._updateVAO[e],null);const p=this._engine;p.bindTransformFeedbackBuffer(s.getBuffer()),p.setRasterizerState(!1),p.beginTransformFeedback(!0),p.drawArraysType(3,0,a),p.endTransformFeedback(),p.setRasterizerState(!0),p.bindTransformFeedbackBuffer(null)}releaseBuffers(){}releaseVertexBuffers(){for(let e=0;e<this._updateVAO.length;e++)this._engine.releaseVertexArrayObject(this._updateVAO[e]);this._updateVAO.length=0;for(let e=0;e<this._renderVAO.length;e++)this._engine.releaseVertexArrayObject(this._renderVAO[e]);this._renderVAO.length=0,this._renderVAOEffects.length=0,this._renderVertexBuffers.length=0}_createUpdateVAO(e){const s={};s.position=e.createVertexBuffer("position",0,3);let a=3;s.age=e.createVertexBuffer("age",a,1),a+=1,s.size=e.createVertexBuffer("size",a,3),a+=3,s.life=e.createVertexBuffer("life",a,1),a+=1,s.seed=e.createVertexBuffer("seed",a,4),a+=4,s.direction=e.createVertexBuffer("direction",a,3),a+=3,this._parent.particleEmitterType instanceof V&&(s.initialPosition=e.createVertexBuffer("initialPosition",a,3),a+=3),this._parent._colorGradientsTexture||(s.color=e.createVertexBuffer("color",a,4),a+=4),this._parent._needsInitialDirection&&(s.initialDirection=e.createVertexBuffer("initialDirection",a,3),a+=3),this._parent.noiseTexture&&(s.noiseCoordinates1=e.createVertexBuffer("noiseCoordinates1",a,3),a+=3,s.noiseCoordinates2=e.createVertexBuffer("noiseCoordinates2",a,3),a+=3),this._parent._angularSpeedGradientsTexture?(s.angle=e.createVertexBuffer("angle",a,1),a+=1):(s.angle=e.createVertexBuffer("angle",a,2),a+=2),this._parent._isAnimationSheetEnabled&&(s.cellIndex=e.createVertexBuffer("cellIndex",a,1),a+=1,this._parent.spriteRandomStartCell&&(s.cellStartOffset=e.createVertexBuffer("cellStartOffset",a,1)));const p=this._engine.recordVertexArrayObject(s,null,this._updateEffect);return this._engine.bindArrayBuffer(null),p}}let G=!1;function ie(){G||(G=!0,W("BABYLON.WebGL2ParticleSystem",te))}const B="gpuUpdateParticlesPixelShader",ne=`#version 300 es
void main() {discard;}
`;z.ShadersStore[B]||(z.ShadersStore[B]=ne);const L="gpuUpdateParticlesVertexShader",ae=`#version 300 es
#define PI 3.14159
uniform float currentCount;uniform float timeDelta;uniform float stopFactor;uniform float emitIndex;uniform float emitCount;
#ifndef LOCAL
uniform mat4 emitterWM;
#endif
uniform vec2 lifeTime;uniform vec2 emitPower;uniform vec2 sizeRange;uniform vec4 scaleRange;
#ifdef FLOWMAP
uniform mat4 flowMapProjection;uniform float flowMapStrength;uniform sampler2D flowMapSampler;
#endif
#ifndef COLORGRADIENTS
uniform vec4 color1;uniform vec4 color2;
#endif
uniform vec3 gravity;uniform sampler2D randomSampler;uniform sampler2D randomSampler2;uniform vec4 angleRange;
#ifdef BOXEMITTER
uniform vec3 direction1;uniform vec3 direction2;uniform vec3 minEmitBox;uniform vec3 maxEmitBox;
#endif
#ifdef POINTEMITTER
uniform vec3 direction1;uniform vec3 direction2;
#endif
#ifdef HEMISPHERICEMITTER
uniform float radius;uniform float radiusRange;uniform float directionRandomizer;
#endif
#ifdef SPHEREEMITTER
uniform float radius;uniform float radiusRange;
#ifdef DIRECTEDSPHEREEMITTER
uniform vec3 direction1;uniform vec3 direction2;
#else
uniform float directionRandomizer;
#endif
#endif
#ifdef CYLINDEREMITTER
uniform float radius;uniform float height;uniform float radiusRange;
#ifdef DIRECTEDCYLINDEREMITTER
uniform vec3 direction1;uniform vec3 direction2;
#else
uniform float directionRandomizer;
#endif
#endif
#ifdef CONEEMITTER
uniform vec2 radius;uniform float coneAngle;uniform vec2 height;
#ifdef DIRECTEDCONEEMITTER
uniform vec3 direction1;uniform vec3 direction2;
#else
uniform float directionRandomizer;
#endif
#endif
in vec3 position;
#ifdef CUSTOMEMITTER
in vec3 initialPosition;
#endif
in float age;in float life;in vec4 seed;in vec3 size;
#ifndef COLORGRADIENTS
in vec4 color;
#endif
in vec3 direction;
#ifndef BILLBOARD
in vec3 initialDirection;
#endif
#ifdef ANGULARSPEEDGRADIENTS
in float angle;
#else
in vec2 angle;
#endif
#ifdef ANIMATESHEET
in float cellIndex;
#ifdef ANIMATESHEETRANDOMSTART
in float cellStartOffset;
#endif
#endif
#ifdef NOISE
in vec3 noiseCoordinates1;in vec3 noiseCoordinates2;
#endif
out vec3 outPosition;
#ifdef CUSTOMEMITTER
out vec3 outInitialPosition;
#endif
out float outAge;out float outLife;out vec4 outSeed;out vec3 outSize;
#ifndef COLORGRADIENTS
out vec4 outColor;
#endif
out vec3 outDirection;
#ifndef BILLBOARD
out vec3 outInitialDirection;
#endif
#ifdef ANGULARSPEEDGRADIENTS
out float outAngle;
#else
out vec2 outAngle;
#endif
#ifdef ANIMATESHEET
out float outCellIndex;
#ifdef ANIMATESHEETRANDOMSTART
out float outCellStartOffset;
#endif
#endif
#ifdef NOISE
out vec3 outNoiseCoordinates1;out vec3 outNoiseCoordinates2;
#endif
#ifdef SIZEGRADIENTS
uniform sampler2D sizeGradientSampler;
#endif 
#ifdef ANGULARSPEEDGRADIENTS
uniform sampler2D angularSpeedGradientSampler;
#endif 
#ifdef VELOCITYGRADIENTS
uniform sampler2D velocityGradientSampler;
#endif
#ifdef LIMITVELOCITYGRADIENTS
uniform sampler2D limitVelocityGradientSampler;uniform float limitVelocityDamping;
#endif
#ifdef DRAGGRADIENTS
uniform sampler2D dragGradientSampler;
#endif
#ifdef NOISE
uniform vec3 noiseStrength;uniform sampler2D noiseSampler;
#endif
#ifdef ANIMATESHEET
uniform vec4 cellInfos;
#endif
#ifdef ATTRACTORS
uniform int attractorCount;uniform vec4 attractorPositionAndStrength[MAX_ATTRACTORS];
#endif
#ifdef STARTSIZEGRADIENTS
uniform float startSizeGradientFactor;
#endif
#ifdef LIFETIMEGRADIENTS
uniform vec2 lifeTimeGradientRange;
#endif
#ifdef MESHEMITTER
uniform sampler2D meshPositionSampler;uniform int meshTriangleCount;uniform int meshTextureWidth;uniform vec3 direction1;uniform vec3 direction2;
#ifdef MESHNORMALS
uniform sampler2D meshNormalSampler;
#endif
#endif
vec3 getRandomVec3(float offset) {return texture(randomSampler2,vec2(float(gl_VertexID)*offset/currentCount,0)).rgb;}
vec4 getRandomVec4(float offset) {return texture(randomSampler,vec2(float(gl_VertexID)*offset/currentCount,0));}
void main() {float newAge=age+timeDelta;
#ifdef EMITRATECTRL
float particleIndex=float(gl_VertexID);float offsetFromEmitIndex=particleIndex-emitIndex;if (offsetFromEmitIndex<0.0) {offsetFromEmitIndex+=currentCount; }
bool shouldEmit=offsetFromEmitIndex<emitCount && stopFactor != 0.;
#else
bool shouldEmit=newAge>=life && stopFactor != 0.;
#endif
if (shouldEmit) {vec3 newPosition;vec3 newDirection;vec4 randoms=getRandomVec4(seed.x);outLife=lifeTime.x+(lifeTime.y-lifeTime.x)*randoms.r;
#ifdef LIFETIMEGRADIENTS
outLife=lifeTimeGradientRange.x+(lifeTimeGradientRange.y-lifeTimeGradientRange.x)*randoms.r;
#endif
#ifdef EMITRATECTRL
outAge=0.0;
#else
outAge=newAge-life;
#endif
outSeed=seed;
#ifdef SIZEGRADIENTS 
vec2 sizeGradientRange=texture(sizeGradientSampler,vec2(0,0)).rg;outSize.x=sizeGradientRange.x+(sizeGradientRange.y-sizeGradientRange.x)*seed.y;
#else
outSize.x=sizeRange.x+(sizeRange.y-sizeRange.x)*randoms.g;
#endif
outSize.y=scaleRange.x+(scaleRange.y-scaleRange.x)*randoms.b;outSize.z=scaleRange.z+(scaleRange.w-scaleRange.z)*randoms.a; 
#ifdef STARTSIZEGRADIENTS
outSize.x*=startSizeGradientFactor;
#endif
#ifndef COLORGRADIENTS
outColor=color1+(color2-color1)*randoms.b;
#endif
#ifndef ANGULARSPEEDGRADIENTS 
outAngle.y=angleRange.x+(angleRange.y-angleRange.x)*randoms.a;outAngle.x=angleRange.z+(angleRange.w-angleRange.z)*randoms.r;
#else
outAngle=angleRange.z+(angleRange.w-angleRange.z)*randoms.r;
#endif 
#ifdef POINTEMITTER
vec3 randoms2=getRandomVec3(seed.y);vec3 randoms3=getRandomVec3(seed.z);newPosition=vec3(0,0,0);newDirection=direction1+(direction2-direction1)*randoms3;
#elif defined(BOXEMITTER)
vec3 randoms2=getRandomVec3(seed.y);vec3 randoms3=getRandomVec3(seed.z);newPosition=minEmitBox+(maxEmitBox-minEmitBox)*randoms2;newDirection=direction1+(direction2-direction1)*randoms3; 
#elif defined(HEMISPHERICEMITTER)
vec3 randoms2=getRandomVec3(seed.y);vec3 randoms3=getRandomVec3(seed.z);float phi=2.0*PI*randoms2.x;float theta=acos(2.0*randoms2.y-1.0);float randX=cos(phi)*sin(theta);float randY=cos(theta);float randZ=sin(phi)*sin(theta);newPosition=(radius-(radius*radiusRange*randoms2.z))*vec3(randX,abs(randY),randZ);vec3 hemisphereDirection=newPosition+directionRandomizer*randoms3;float hemisphereDirectionLength=length(hemisphereDirection);newDirection=hemisphereDirectionLength>0.0 ? hemisphereDirection/hemisphereDirectionLength : vec3(0.0);
#elif defined(SPHEREEMITTER)
vec3 randoms2=getRandomVec3(seed.y);vec3 randoms3=getRandomVec3(seed.z);float phi=2.0*PI*randoms2.x;float theta=acos(2.0*randoms2.y-1.0);float randX=cos(phi)*sin(theta);float randY=cos(theta);float randZ=sin(phi)*sin(theta);newPosition=(radius-(radius*radiusRange*randoms2.z))*vec3(randX,randY,randZ);
#ifdef DIRECTEDSPHEREEMITTER
newDirection=direction1+(direction2-direction1)*randoms3;
#else
newDirection=normalize(newPosition+directionRandomizer*randoms3);
#endif
#elif defined(CYLINDEREMITTER)
vec3 randoms2=getRandomVec3(seed.y);vec3 randoms3=getRandomVec3(seed.z);float yPos=(randoms2.x-0.5)*height;float angle=randoms2.y*PI*2.;float inverseRadiusRangeSquared=((1.-radiusRange)*(1.-radiusRange));float positionRadius=radius*sqrt(inverseRadiusRangeSquared+(randoms2.z*(1.-inverseRadiusRangeSquared)));float xPos=positionRadius*cos(angle);float zPos=positionRadius*sin(angle);newPosition=vec3(xPos,yPos,zPos);
#ifdef DIRECTEDCYLINDEREMITTER
newDirection=direction1+(direction2-direction1)*randoms3;
#else
angle=angle+((randoms3.x-0.5)*PI)*directionRandomizer;newDirection=vec3(cos(angle),(randoms3.y-0.5)*directionRandomizer,sin(angle));newDirection=normalize(newDirection);
#endif
#elif defined(CONEEMITTER)
vec3 randoms2=getRandomVec3(seed.y);float s=2.0*PI*randoms2.x;
#ifdef CONEEMITTERSPAWNPOINT
float h=0.0001;
#else
float h=randoms2.y*height.y;h=1.-h*h; 
#endif
float lRadius=radius.x-radius.x*randoms2.z*radius.y;lRadius=lRadius*h;float randX=lRadius*sin(s);float randZ=lRadius*cos(s);float randY=h *height.x;newPosition=vec3(randX,randY,randZ); 
vec3 randoms3=getRandomVec3(seed.z);
#ifdef DIRECTEDCONEEMITTER
newDirection=direction1+(direction2-direction1)*randoms3;
#else
if (abs(cos(coneAngle))==1.0) {newDirection=vec3(0.,1.0,0.);} else {newDirection=normalize(newPosition+directionRandomizer*randoms3); }
#endif
#elif defined(MESHEMITTER)
vec3 randoms2=getRandomVec3(seed.y);vec3 randoms3=getRandomVec3(seed.z);int triIdx=int(floor(randoms2.x*float(meshTriangleCount)));triIdx=min(triIdx,meshTriangleCount-1);int baseTexel=triIdx*3;int t0=baseTexel;int t1=baseTexel+1;int t2=baseTexel+2;vec3 v0=texelFetch(meshPositionSampler,ivec2(t0 % meshTextureWidth,t0/meshTextureWidth),0).xyz;vec3 v1=texelFetch(meshPositionSampler,ivec2(t1 % meshTextureWidth,t1/meshTextureWidth),0).xyz;vec3 v2=texelFetch(meshPositionSampler,ivec2(t2 % meshTextureWidth,t2/meshTextureWidth),0).xyz;float bu=randoms2.y;float bv=randoms2.z*(1.0-bu);float bw=1.0-bu-bv;newPosition=bu*v0+bv*v1+bw*v2;
#ifdef MESHNORMALS
vec3 n0=texelFetch(meshNormalSampler,ivec2(t0 % meshTextureWidth,t0/meshTextureWidth),0).xyz;vec3 n1=texelFetch(meshNormalSampler,ivec2(t1 % meshTextureWidth,t1/meshTextureWidth),0).xyz;vec3 n2=texelFetch(meshNormalSampler,ivec2(t2 % meshTextureWidth,t2/meshTextureWidth),0).xyz;newDirection=normalize(bu*n0+bv*n1+bw*n2);
#else
newDirection=direction1+(direction2-direction1)*randoms3;
#endif
#elif defined(CUSTOMEMITTER)
newPosition=initialPosition;outInitialPosition=initialPosition;
#else 
newPosition=vec3(0.,0.,0.);newDirection=2.0*(getRandomVec3(seed.w)-vec3(0.5,0.5,0.5));
#endif
float power=emitPower.x+(emitPower.y-emitPower.x)*randoms.a;
#ifdef LOCAL
outPosition=newPosition;
#else
outPosition=(emitterWM*vec4(newPosition,1.)).xyz;
#endif
#ifdef CUSTOMEMITTER
outDirection=direction;
#ifndef BILLBOARD 
outInitialDirection=direction;
#endif
#else
#ifdef LOCAL
vec3 initial=newDirection;
#else 
vec3 initial=(emitterWM*vec4(newDirection,0.)).xyz;
#endif
outDirection=initial*power;
#ifndef BILLBOARD 
outInitialDirection=initial;
#endif
#endif
#ifdef ANIMATESHEET 
outCellIndex=cellInfos.x;
#ifdef ANIMATESHEETRANDOMSTART
outCellStartOffset=randoms.a*outLife;
#endif 
#endif
#ifdef NOISE
outNoiseCoordinates1=noiseCoordinates1;outNoiseCoordinates2=noiseCoordinates2;
#endif
} else {float directionScale=timeDelta;outAge=newAge;float ageGradient=newAge/life;
#ifdef VELOCITYGRADIENTS
vec2 velocityGradientRange=texture(velocityGradientSampler,vec2(ageGradient,0)).rg;directionScale*=velocityGradientRange.x+(velocityGradientRange.y-velocityGradientRange.x)*seed.w;
#endif
#ifdef DRAGGRADIENTS
vec2 dragGradientRange=texture(dragGradientSampler,vec2(ageGradient,0)).rg;directionScale*=1.0-(dragGradientRange.x+(dragGradientRange.y-dragGradientRange.x)*seed.x);
#endif
#if defined(CUSTOMEMITTER)
outPosition=position+(direction-position)*ageGradient; 
outInitialPosition=initialPosition;
#else
outPosition=position+direction*directionScale;
#endif
outLife=life;outSeed=seed;
#ifndef COLORGRADIENTS 
outColor=color;
#endif
#ifdef SIZEGRADIENTS
vec2 sizeGradientRange=texture(sizeGradientSampler,vec2(ageGradient,0)).rg;outSize.x=sizeGradientRange.x+(sizeGradientRange.y-sizeGradientRange.x)*seed.y;outSize.yz=size.yz;
#else
outSize=size;
#endif 
#ifndef BILLBOARD 
outInitialDirection=initialDirection;
#endif
#ifdef CUSTOMEMITTER
outDirection=direction;
#else
vec3 updatedDirection=direction+gravity*timeDelta;
#ifdef FLOWMAP
vec4 clipSpace=(flowMapProjection*vec4(position,1.));vec3 ndcSpace=clipSpace.xyz/clipSpace.w;vec2 flowMapUV=ndcSpace.xy*0.5+0.5;vec4 flowMapValue=texture(flowMapSampler,flowMapUV);vec3 flowMapDirection=(flowMapValue.xyz*2.0-1.0)*flowMapValue.w;updatedDirection+=flowMapDirection*timeDelta*flowMapStrength;
#endif
#ifdef LIMITVELOCITYGRADIENTS
vec2 limitVelocityRange=texture(limitVelocityGradientSampler,vec2(ageGradient,0)).rg;float limitVelocity=limitVelocityRange.x+(limitVelocityRange.y-limitVelocityRange.x)*seed.y;float currentVelocity=length(updatedDirection);if (currentVelocity>limitVelocity) {updatedDirection=updatedDirection*limitVelocityDamping;}
#endif
#ifdef ATTRACTORS
{for (int i=0; i<attractorCount; i++) {vec3 toAttractor=attractorPositionAndStrength[i].xyz-outPosition;float distSq=dot(toAttractor,toAttractor)+1.0;updatedDirection+=(attractorPositionAndStrength[i].w/distSq)*normalize(toAttractor)*timeDelta;}}
#endif
outDirection=updatedDirection;
#ifdef NOISE
float fetchedR=texture(noiseSampler,vec2(noiseCoordinates1.x,noiseCoordinates1.y)*vec2(0.5)+vec2(0.5)).r;float fetchedG=texture(noiseSampler,vec2(noiseCoordinates1.z,noiseCoordinates2.x)*vec2(0.5)+vec2(0.5)).r;float fetchedB=texture(noiseSampler,vec2(noiseCoordinates2.y,noiseCoordinates2.z)*vec2(0.5)+vec2(0.5)).r;vec3 force=vec3(2.*fetchedR-1.,2.*fetchedG-1.,2.*fetchedB-1.)*noiseStrength;outDirection=outDirection+force*timeDelta;outNoiseCoordinates1=noiseCoordinates1;outNoiseCoordinates2=noiseCoordinates2;
#endif 
#endif 
#ifdef ANGULARSPEEDGRADIENTS
vec2 angularSpeedRange=texture(angularSpeedGradientSampler,vec2(ageGradient,0)).rg;float angularSpeed=angularSpeedRange.x+(angularSpeedRange.y-angularSpeedRange.x)*seed.z;outAngle=angle+angularSpeed*timeDelta;
#else
outAngle=vec2(angle.x+angle.y*timeDelta,angle.y);
#endif
#ifdef ANIMATESHEET 
float offsetAge=outAge;float dist=cellInfos.y-cellInfos.x;
#ifdef ANIMATESHEETRANDOMSTART
outCellStartOffset=cellStartOffset;offsetAge+=cellStartOffset;
#else
float cellStartOffset=0.;
#endif 
float ratio=0.;if (cellInfos.w==1.0) {ratio=clamp(mod(cellStartOffset+cellInfos.z*offsetAge,life)/life,0.,1.0);}
else {ratio=clamp(cellStartOffset+cellInfos.z*offsetAge/life,0.,1.0);}
outCellIndex=float(int(cellInfos.x+ratio*dist));
#endif
}}`;z.ShadersStore[L]||(z.ShadersStore[L]=ae);ie();K(X);let H=(()=>{var o;let e,s=[],a=[],p,E=[],C=[];return o=class{constructor(){this.buttons=d(this,s,[0,1,2]),this.buttonsYaw=(d(this,a),[-1,0,1]),this.buttonsPitch=[-1,0,1],this.buttonsRoll=[2],this.activeButton=-1,this.angularSensibility=d(this,E,1e3),this._observer=d(this,C),this._previousPosition=null,this._pointerConditions={}}attachControl(r){r=F.BackCompatCameraNoPreventDefault(arguments),this._noPreventDefault=r,this._observer=this.camera.getScene()._inputManager._addCameraPointerObserver(l=>{this._pointerInput(l)},D.POINTERDOWN|D.POINTERUP|D.POINTERMOVE),this._rollObserver=this.camera.getScene().onBeforeRenderObservable.add(()=>{this.camera.rollCorrect&&this.camera.restoreRoll(this.camera.rollCorrect)})}detachControl(){this._observer&&(this.camera.getScene()._inputManager._removeCameraPointerObserver(this._observer),this.camera.getScene().onBeforeRenderObservable.remove(this._rollObserver),this._observer=null,this._rollObserver=null,this._previousPosition=null,this._noPreventDefault=void 0)}getClassName(){return"FlyCameraMouseInput"}getSimpleName(){return"mouse"}_pointerInput(r){const l=r.event,y=this.camera.getEngine();if(!this.touchEnabled&&l.pointerType==="touch"||r.type!==D.POINTERMOVE&&this.buttons.indexOf(l.button)===-1)return;const v=l.target;if(r.type===D.POINTERDOWN){try{v?.setPointerCapture(l.pointerId)}catch{}this._previousPosition={x:l.clientX,y:l.clientY},this.activeButton=l.button,this._noPreventDefault||l.preventDefault(),y.isPointerLock&&this._onMouseMove(r.event)}else if(r.type===D.POINTERUP){try{v?.releasePointerCapture(l.pointerId)}catch{}this.activeButton=-1,this._previousPosition=null,this._noPreventDefault||l.preventDefault()}else if(r.type===D.POINTERMOVE){if(!this._previousPosition){y.isPointerLock&&this._onMouseMove(r.event);return}const S=l.clientX-this._previousPosition.x,R=l.clientY-this._previousPosition.y;this._rotateCamera(S,R),this._previousPosition={x:l.clientX,y:l.clientY},this._noPreventDefault||l.preventDefault()}}_onMouseMove(r){if(!this.camera.getEngine().isPointerLock)return;const y=r.movementX,v=r.movementY;this._rotateCamera(y,v),this._previousPosition=null,this._noPreventDefault||r.preventDefault()}_rotateCamera(r,l){const c=this.camera;this._pointerConditions.button=this.activeButton;const y=c.movement.input.resolveInteraction("pointer",this._pointerConditions);if(!y||y.interaction!=="rotate")return;const v=c._calculateHandednessMultiplier(),S=y.sensitivityX??y.sensitivity??1/this.angularSensibility,R=y.sensitivityY??y.sensitivity??1/this.angularSensibility,t=r*v*S,n=l*v*R,_=M.RotationYawPitchRoll(c.rotation.y,c.rotation.x,c.rotation.z);let m;if(this.buttonsPitch.some(f=>f===this.activeButton)&&(m=M.RotationAxis(w.X,n),_.multiplyInPlace(m)),this.buttonsYaw.some(f=>f===this.activeButton)){m=M.RotationAxis(w.Y,t),_.multiplyInPlace(m);const f=c.bankedTurnLimit+c._trackRoll;if(c.bankedTurn&&-f<c.rotation.z&&c.rotation.z<f){const i=c.bankedTurnMultiplier*-t;m=M.RotationAxis(w.Z,i),_.multiplyInPlace(m)}}this.buttonsRoll.some(f=>f===this.activeButton)&&(m=M.RotationAxis(w.Z,-t),c._trackRoll-=t,_.multiplyInPlace(m)),_.toEulerAnglesToRef(c.rotation)}},(()=>{const x=typeof Symbol=="function"&&Symbol.metadata?Object.create(null):void 0;e=[I()],p=[I()],T(null,null,e,{kind:"field",name:"buttons",static:!1,private:!1,access:{has:r=>"buttons"in r,get:r=>r.buttons,set:(r,l)=>{r.buttons=l}},metadata:x},s,a),T(null,null,p,{kind:"field",name:"angularSensibility",static:!1,private:!1,access:{has:r=>"angularSensibility"in r,get:r=>r.angularSensibility,set:(r,l)=>{r.angularSensibility=l}},metadata:x},E,C),x&&Object.defineProperty(o,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:x})})(),o})();Y.FlyCameraMouseInput=H;let Z=(()=>{var o;let e,s=[],a=[],p,E=[],C=[],x,r=[],l=[],c,y=[],v=[],S,R=[],t=[],n,_=[],m=[];return o=class{constructor(){this.keysForward=d(this,s,[87]),this.keysBackward=(d(this,a),d(this,E,[83])),this.keysUp=(d(this,C),d(this,r,[69])),this.keysDown=(d(this,l),d(this,y,[81])),this.keysRight=(d(this,v),d(this,R,[68])),this.keysLeft=(d(this,t),d(this,_,[65])),this._keys=(d(this,m),new Array)}attachControl(i){i=F.BackCompatCameraNoPreventDefault(arguments),!this._onCanvasBlurObserver&&(this._scene=this.camera.getScene(),this._engine=this._scene.getEngine(),this._onCanvasBlurObserver=this._engine.onCanvasBlurObservable.add(()=>{this._keys.length=0}),this._onKeyboardObserver=this._scene.onKeyboardObservable.add(u=>{const h=u.event;if(u.type===j.KEYDOWN)(this.keysForward.indexOf(h.keyCode)!==-1||this.keysBackward.indexOf(h.keyCode)!==-1||this.keysUp.indexOf(h.keyCode)!==-1||this.keysDown.indexOf(h.keyCode)!==-1||this.keysLeft.indexOf(h.keyCode)!==-1||this.keysRight.indexOf(h.keyCode)!==-1)&&(this._keys.indexOf(h.keyCode)===-1&&this._keys.push(h.keyCode),i||h.preventDefault());else if(this.keysForward.indexOf(h.keyCode)!==-1||this.keysBackward.indexOf(h.keyCode)!==-1||this.keysUp.indexOf(h.keyCode)!==-1||this.keysDown.indexOf(h.keyCode)!==-1||this.keysLeft.indexOf(h.keyCode)!==-1||this.keysRight.indexOf(h.keyCode)!==-1){const g=this._keys.indexOf(h.keyCode);g>=0&&this._keys.splice(g,1),i||h.preventDefault()}}))}detachControl(){this._scene&&(this._onKeyboardObserver&&this._scene.onKeyboardObservable.remove(this._onKeyboardObserver),this._onCanvasBlurObserver&&this._engine.onCanvasBlurObservable.remove(this._onCanvasBlurObserver),this._onKeyboardObserver=null,this._onCanvasBlurObserver=null),this._keys.length=0}getClassName(){return"FlyCameraKeyboardInput"}_onLostFocus(){this._keys.length=0}getSimpleName(){return"keyboard"}checkInputs(){if(this._onKeyboardObserver){const i=this.camera,u=i.movement.input.getEntry("keyboard","translate");if(!u)return;const h=u.sensitivity??1,g=i._localDirection.copyFromFloats(0,0,0);for(let P=0;P<this._keys.length;P++){const A=this._keys[P];this.keysForward.indexOf(A)!==-1?g.z+=1:this.keysBackward.indexOf(A)!==-1?g.z-=1:this.keysUp.indexOf(A)!==-1?g.y+=1:this.keysDown.indexOf(A)!==-1?g.y-=1:this.keysRight.indexOf(A)!==-1?g.x+=1:this.keysLeft.indexOf(A)!==-1&&(g.x-=1)}if(g.x!==0||g.y!==0||g.z!==0){const P=i._computeLocalCameraSpeed()*h;g.normalize().scaleInPlace(P),i.getScene().useRightHandedSystem&&(g.z*=-1),i.getViewMatrix().invertToRef(i._cameraTransformMatrix),k.TransformNormalToRef(g,i._cameraTransformMatrix,i._transformedDirection),i.cameraDirection.addInPlace(i._transformedDirection)}}}},(()=>{const f=typeof Symbol=="function"&&Symbol.metadata?Object.create(null):void 0;e=[I()],p=[I()],x=[I()],c=[I()],S=[I()],n=[I()],T(null,null,e,{kind:"field",name:"keysForward",static:!1,private:!1,access:{has:i=>"keysForward"in i,get:i=>i.keysForward,set:(i,u)=>{i.keysForward=u}},metadata:f},s,a),T(null,null,p,{kind:"field",name:"keysBackward",static:!1,private:!1,access:{has:i=>"keysBackward"in i,get:i=>i.keysBackward,set:(i,u)=>{i.keysBackward=u}},metadata:f},E,C),T(null,null,x,{kind:"field",name:"keysUp",static:!1,private:!1,access:{has:i=>"keysUp"in i,get:i=>i.keysUp,set:(i,u)=>{i.keysUp=u}},metadata:f},r,l),T(null,null,c,{kind:"field",name:"keysDown",static:!1,private:!1,access:{has:i=>"keysDown"in i,get:i=>i.keysDown,set:(i,u)=>{i.keysDown=u}},metadata:f},y,v),T(null,null,S,{kind:"field",name:"keysRight",static:!1,private:!1,access:{has:i=>"keysRight"in i,get:i=>i.keysRight,set:(i,u)=>{i.keysRight=u}},metadata:f},R,t),T(null,null,n,{kind:"field",name:"keysLeft",static:!1,private:!1,access:{has:i=>"keysLeft"in i,get:i=>i.keysLeft,set:(i,u)=>{i.keysLeft=u}},metadata:f},_,m),f&&Object.defineProperty(o,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:f})})(),o})();Y.FlyCameraKeyboardInput=Z;class se extends q{constructor(e){super(e)}addKeyboard(){return this.add(new Z),this}addMouse(){return this.add(new H),this}}let re=(()=>{var o;let e=$,s,a=[],p=[],E,C=[],x=[],r,l=[],c=[],y,v=[],S=[];return o=class extends e{get angularSensibility(){const t=this.inputs.attached.mouse;return t?t.angularSensibility:0}set angularSensibility(t){const n=this.inputs.attached.mouse;n&&(n.angularSensibility=t)}get keysForward(){const t=this.inputs.attached.keyboard;return t?t.keysForward:[]}set keysForward(t){const n=this.inputs.attached.keyboard;n&&(n.keysForward=t)}get keysBackward(){const t=this.inputs.attached.keyboard;return t?t.keysBackward:[]}set keysBackward(t){const n=this.inputs.attached.keyboard;n&&(n.keysBackward=t)}get keysUp(){const t=this.inputs.attached.keyboard;return t?t.keysUp:[]}set keysUp(t){const n=this.inputs.attached.keyboard;n&&(n.keysUp=t)}get keysDown(){const t=this.inputs.attached.keyboard;return t?t.keysDown:[]}set keysDown(t){const n=this.inputs.attached.keyboard;n&&(n.keysDown=t)}get keysLeft(){const t=this.inputs.attached.keyboard;return t?t.keysLeft:[]}set keysLeft(t){const n=this.inputs.attached.keyboard;n&&(n.keysLeft=t)}get keysRight(){const t=this.inputs.attached.keyboard;return t?t.keysRight:[]}set keysRight(t){const n=this.inputs.attached.keyboard;n&&(n.keysRight=t)}constructor(t,n,_,m=!0){super(t,n,_,m),this.ellipsoid=d(this,a,new k(1,1,1)),this.ellipsoidOffset=(d(this,p),d(this,C,new k(0,0,0))),this.checkCollisions=(d(this,x),d(this,l,!1)),this.applyGravity=(d(this,c),d(this,v,!1)),this.cameraDirection=(d(this,S),k.Zero()),this._trackRoll=0,this.rollCorrect=100,this.bankedTurn=!1,this.bankedTurnLimit=Math.PI/2,this.bankedTurnMultiplier=1,this._needMoveForGravity=!1,this._oldPosition=k.Zero(),this._diffPosition=k.Zero(),this._newPosition=k.Zero(),this._collisionMask=-1,this._onCollisionPositionChange=(f,i,u=null)=>{(g=>{this._newPosition.copyFrom(g),this._newPosition.subtractToRef(this._oldPosition,this._diffPosition),this._diffPosition.length()>Q.CollisionsEpsilon&&(this.position.addInPlace(this._diffPosition),this.onCollide&&u&&this.onCollide(u))})(i)},this.inputs=new se(this),this.inputs.addKeyboard().addMouse()}attachControl(t,n){n=F.BackCompatCameraNoPreventDefault(arguments),this.inputs.attachElement(n)}detachControl(){this.inputs.detachElement(),this.cameraDirection=new k(0,0,0)}get collisionMask(){return this._collisionMask}set collisionMask(t){this._collisionMask=isNaN(t)?-1:t}_collideWithWorld(t){let n;this.parent?n=k.TransformCoordinates(this.position,this.parent.getWorldMatrix()):n=this.position,n.subtractFromFloatsToRef(0,this.ellipsoid.y,0,this._oldPosition),this._oldPosition.addInPlace(this.ellipsoidOffset);const _=this.getScene().collisionCoordinator;this._collider||(this._collider=_.createCollider()),this._collider._radius=this.ellipsoid,this._collider.collisionMask=this._collisionMask;let m=t;this.applyGravity&&(m=t.add(this.getScene().gravity)),_.getNewPosition(this._oldPosition,m,this._collider,3,null,this._onCollisionPositionChange,this.uniqueId)}_checkInputs(){this._localDirection||(this._localDirection=k.Zero(),this._transformedDirection=k.Zero()),this.inputs.checkInputs(),super._checkInputs()}set needMoveForGravity(t){this._needMoveForGravity=t}get needMoveForGravity(){return this._needMoveForGravity}_decideIfNeedsToMove(){return this._needMoveForGravity||Math.abs(this.cameraDirection.x)>0||Math.abs(this.cameraDirection.y)>0||Math.abs(this.cameraDirection.z)>0}_updatePosition(){this.checkCollisions&&this.getScene().collisionsEnabled?this._collideWithWorld(this.cameraDirection):super._updatePosition()}restoreRoll(t){const n=this._trackRoll,_=this.rotation.z,m=n-_,f=.001;Math.abs(m)>=f&&(this.rotation.z+=m/t,Math.abs(n-this.rotation.z)<=f&&(this.rotation.z=n))}dispose(){this.inputs.clear(),super.dispose()}getClassName(){return"FlyCamera"}},(()=>{const R=typeof Symbol=="function"&&Symbol.metadata?Object.create(e[Symbol.metadata]??null):void 0;s=[N()],E=[N()],r=[I()],y=[I()],T(null,null,s,{kind:"field",name:"ellipsoid",static:!1,private:!1,access:{has:t=>"ellipsoid"in t,get:t=>t.ellipsoid,set:(t,n)=>{t.ellipsoid=n}},metadata:R},a,p),T(null,null,E,{kind:"field",name:"ellipsoidOffset",static:!1,private:!1,access:{has:t=>"ellipsoidOffset"in t,get:t=>t.ellipsoidOffset,set:(t,n)=>{t.ellipsoidOffset=n}},metadata:R},C,x),T(null,null,r,{kind:"field",name:"checkCollisions",static:!1,private:!1,access:{has:t=>"checkCollisions"in t,get:t=>t.checkCollisions,set:(t,n)=>{t.checkCollisions=n}},metadata:R},l,c),T(null,null,y,{kind:"field",name:"applyGravity",static:!1,private:!1,access:{has:t=>"applyGravity"in t,get:t=>t.applyGravity,set:(t,n)=>{t.applyGravity=n}},metadata:R},v,S),R&&Object.defineProperty(o,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:R})})(),o})(),U=!1;function oe(){U||(U=!0,W("BABYLON.FlyCamera",re))}oe();export{re as F,ee as R,J as U,te as W,fe as _,se as a,Z as b,H as c,oe as d,ie as e};
