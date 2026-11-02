const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./textureMerger.fragment-D3PFHhgY.js","./index-1uQtRKdo.js","./index-CC8xdnzA.css","./textureMerger.fragment-S94QEYLr.js","./greasedLine.vertex-D44pfVm8.js","./instancesDeclaration-MYibuUQX.js","./sceneUboDeclaration-CT0sivxr.js","./meshUboDeclaration-DhxHXuR6.js","./instancesVertex-MtlZIlMJ.js","./greasedLine.fragment-BG-8IHrL.js","./greasedLine.vertex-h5iK0iTK.js","./instancesDeclaration-C-zmTfMR.js","./instancesVertex-iNntjH0Z.js","./greasedLine.fragment-DE2DFoM1.js"])))=>i.map(i=>d[i]);
import{cs as v,km as G,L as z,fo as R,jz as W,cV as D,fi as V,Y as A,_ as y,h as N,V as x,a3 as H,o as T,fG as k,hR as $,b1 as O,a_ as j,ad as Y,ac as X,av as q,mc as Z,l7 as K,f as Q,bi as J,z as L,B as ee,nE as te}from"./index-1uQtRKdo.js";import{P as re}from"./proceduralTexture.pure-Bv3j1evZ.js";import{b as se,_ as ie,c as oe,a as b}from"./textureSampling.functions-D8R_9uHy.js";class le{constructor(){this.renderWidth=512,this.renderHeight=256,this.textureSize=512,this.deterministicLockstep=!1,this.lockstepMaxSteps=4}}class pe extends v{isDeterministicLockStep(){return this._options.deterministicLockstep}getLockstepMaxSteps(){return this._options.lockstepMaxSteps}getHardwareScalingLevel(){return 1}get supportsUniformBuffers(){return!!this._options?.enableMultiview||this.webGLVersion>1&&!this.disableUniformBuffers}constructor(e=new le){super(null),e.deterministicLockstep===void 0&&(e.deterministicLockstep=!1),e.timeStep!==void 0&&(this._timeStep=e.timeStep),e.lockstepMaxSteps===void 0&&(e.lockstepMaxSteps=4),this._options=e,G.SetMatrixPrecision(!!e.useHighPrecisionMatrix),this._caps={maxTexturesImageUnits:16,maxVertexTextureImageUnits:16,maxCombinedTexturesImageUnits:32,maxTextureSize:512,maxCubemapTextureSize:512,maxDrawBuffers:0,maxRenderTextureSize:512,maxVertexAttribs:16,maxVaryingVectors:16,maxFragmentUniformVectors:16,maxVertexUniformVectors:16,shaderFloatPrecision:10,standardDerivatives:!1,astc:null,pvrtc:null,etc1:null,etc2:null,bptc:null,maxAnisotropy:0,uintIndices:!1,fragmentDepthSupported:!1,highPrecisionShaderSupported:!0,colorBufferFloat:!1,blendFloat:!1,supportFloatTexturesResolve:!1,rg11b10ufColorRenderable:!1,textureFloat:!1,textureFloatLinearFiltering:!1,textureFloatRender:!1,textureHalfFloat:!1,textureHalfFloatLinearFiltering:!1,textureHalfFloatRender:!1,textureLOD:!1,texelFetch:!1,drawBuffersExtension:!1,depthTextureExtension:!1,vertexArrayObject:!1,instancedArrays:!1,supportOcclusionQuery:!1,canUseTimestampForTimerQuery:!1,maxMSAASamples:1,blendMinMax:!1,canUseGLInstanceID:!1,canUseGLVertexID:!1,supportComputeShaders:!1,supportSRGBBuffers:!1,supportTransformFeedbacks:!1,textureMaxLevel:!1,texture2DArrayMaxLayerCount:128,disableMorphTargetTexture:!1,textureNorm16:!1,blendParametersPerTarget:!1,dualSourceBlending:!1,supportReadWriteStorageTextures:!1},e.enableMultiview&&(this._caps.multiview={framebufferTextureMultiviewOVR:()=>{}}),this._features={forceBitmapOverHTMLImageElement:!1,supportRenderAndCopyToLodForFloatTextures:!1,supportDepthStencilTexture:!1,supportShadowSamplers:!1,uniformBufferHardCheckMatrix:!1,allowTexturePrefiltering:!1,trackUbosInFrame:!1,checkUbosContentBeforeUpload:!1,supportCSM:!1,basisNeedsPOT:!1,support3DTextures:!1,needTypeSuffixInShaderConstants:!1,supportMSAA:!1,supportSSAO2:!1,supportIBLShadows:!1,supportExtendedTextureFormats:!1,supportSwitchCaseInShader:!1,supportSyncTextureRead:!1,needsInvertingBitmap:!1,useUBOBindingCache:!1,needShaderCodeInlining:!1,needToAlwaysBindUniformBuffers:!1,supportRenderPasses:!0,supportSpriteInstancing:!1,forceVertexBufferStrideAndOffsetMultiple4Bytes:!1,_checkNonFloatVertexBuffersDontRecreatePipelineContext:!1},e.renderingCanvas&&(this._renderingCanvas=e.renderingCanvas),z.Log(`Babylon.js v${v.Version} - Null engine`);const t=typeof self<"u"?self:typeof global<"u"?global:window;typeof URL>"u"&&(t.URL={createObjectURL:function(){},revokeObjectURL:function(){}}),typeof Blob>"u"&&(t.Blob=function(){})}createVertexBuffer(e){const t=new R;return t.references=1,t}createIndexBuffer(e){const t=new R;return t.references=1,t}clear(e,t,s,r=!1){}getRenderWidth(e=!1){return!e&&this._currentRenderTarget?this._currentRenderTarget.width:this._options.renderWidth}getRenderHeight(e=!1){return!e&&this._currentRenderTarget?this._currentRenderTarget.height:this._options.renderHeight}setViewport(e,t,s){this._cachedViewport=e}createUniformBuffer(e){const t=new R;return t.references=1,t.capacity=e instanceof Array?e.length*Float32Array.BYTES_PER_ELEMENT:e.byteLength,t}createDynamicUniformBuffer(e){return this.createUniformBuffer(e)}updateUniformBuffer(e,t,s,r){}bindUniformBufferBase(e,t,s){}bindUniformBlock(e,t,s){}createShaderProgram(e,t,s,r,i){return{__SPECTOR_rebuildProgram:null}}getUniforms(e,t){return[]}getAttributes(e,t){return[]}bindSamplers(e){this._currentEffect=null}enableEffect(e){e=e!==null&&W(e)?e.effect:e,this._currentEffect=e,e&&(e.onBind&&e.onBind(e),e._onBindObservable&&e._onBindObservable.notifyObservers(e))}setStateCullFaceType(e,t){}setState(e,t=0,s,r=!1,i,o,l=0){}setIntArray(e,t){return!0}setIntArray2(e,t){return!0}setIntArray3(e,t){return!0}setIntArray4(e,t){return!0}setFloatArray(e,t){return!0}setFloatArray2(e,t){return!0}setFloatArray3(e,t){return!0}setFloatArray4(e,t){return!0}setArray(e,t){return!0}setArray2(e,t){return!0}setArray3(e,t){return!0}setArray4(e,t){return!0}setMatrices(e,t){return!0}setMatrix3x3(e,t){return!0}setMatrix2x2(e,t){return!0}setFloat(e,t){return!0}setFloat2(e,t,s){return!0}setFloat3(e,t,s,r){return!0}setBool(e,t){return!0}setFloat4(e,t,s,r,i){return!0}setAlphaMode(e,t=!1,s=0){this._alphaMode[s]!==e&&(this.alphaState.setAlphaBlend(e!==0,0),t||this.setDepthWrite(e===0),this._alphaMode[s]=e)}bindBuffers(e,t,s){}wipeCaches(e){this.preventCacheWipeBetweenFrames||(this.resetTextureCache(),this._currentEffect=null,e&&(this._currentProgram=null,this._stencilStateComposer.reset(),this.depthCullingState.reset(),this.alphaState.reset()),this._cachedVertexBuffers=null,this._cachedIndexBuffer=null,this._cachedEffectForVertexBuffers=null)}draw(e,t,s,r){}drawElementsType(e,t,s,r){}drawArraysType(e,t,s,r){}_createTexture(){return{}}_releaseTexture(e){}createTexture(e,t,s,r,i=3,o=null,l=null,h=null,c=null,m=null,C=null,d){const u=new D(this,1),a=String(e);return u.url=a,u.generateMipMaps=!t,u.samplingMode=i,u.invertY=s,u.baseWidth=this._options.textureSize,u.baseHeight=this._options.textureSize,u.width=this._options.textureSize,u.height=this._options.textureSize,m&&(u.format=m),h&&(u._buffer=h),u.isReady=!0,o&&setTimeout(()=>{o(u)}),this._internalTexturesCache.push(u),u}_createHardwareRenderTargetWrapper(e,t,s){const r=new V(e,t,s,this);return this._renderTargetWrapperCache.push(r),r}createRenderTargetTexture(e,t){const s=this._createHardwareRenderTargetWrapper(!1,!1,e),r={};t!==void 0&&typeof t=="object"?(r.generateMipMaps=t.generateMipMaps,r.generateDepthBuffer=t.generateDepthBuffer===void 0?!0:t.generateDepthBuffer,r.generateStencilBuffer=r.generateDepthBuffer&&t.generateStencilBuffer,r.type=t.type===void 0?0:t.type,r.samplingMode=t.samplingMode===void 0?3:t.samplingMode):(r.generateMipMaps=t,r.generateDepthBuffer=!0,r.generateStencilBuffer=!1,r.type=0,r.samplingMode=3);const i=new D(this,5);s.setTexture(i);const o=e.width||e,l=e.height||e;return s._generateDepthBuffer=r.generateDepthBuffer,s._generateStencilBuffer=!!r.generateStencilBuffer,i.baseWidth=o,i.baseHeight=l,i.width=o,i.height=l,i.isReady=!0,i.samples=1,i.generateMipMaps=!!r.generateMipMaps,i.samplingMode=r.samplingMode,i.type=r.type,this._internalTexturesCache.push(i),s}createMultiviewRenderTargetTexture(e,t){if(!this.getCaps().multiview)throw new Error("Multiview is not supported");const s=this._createHardwareRenderTargetWrapper(!1,!1,{width:e,height:t}),r=new D(this,5,!0);return r.baseWidth=e,r.baseHeight=t,r.width=e,r.height=t,r.isMultiview=!0,r.isReady=!0,r.format=5,r.samples=1,s.setTextures(r),s}bindMultiviewFramebuffer(e){this.bindFramebuffer(e,void 0,void 0,void 0,!0)}createRenderTargetCubeTexture(e,t){const s=this._createHardwareRenderTargetWrapper(!1,!0,e),r={generateMipMaps:!0,generateDepthBuffer:!0,generateStencilBuffer:!1,type:0,samplingMode:3,...t};r.generateStencilBuffer=r.generateDepthBuffer&&r.generateStencilBuffer,(r.type===1&&!this._caps.textureFloatLinearFiltering||r.type===2&&!this._caps.textureHalfFloatLinearFiltering)&&(r.samplingMode=1),s._generateDepthBuffer=r.generateDepthBuffer,s._generateStencilBuffer=!!r.generateStencilBuffer;const i=new D(this,5);return i.baseWidth=e,i.baseHeight=e,i.width=e,i.height=e,i.isReady=!0,i.isCube=!0,i.samples=1,i.generateMipMaps=!!r.generateMipMaps,i.samplingMode=r.samplingMode,i.type=r.type,this._internalTexturesCache.push(i),s}updateTextureSamplingMode(e,t){t.samplingMode=e}createRawTexture(e,t,s,r,i,o,l,h=null,c=0,m=0,C=!1){const d=new D(this,3);return d.baseWidth=t,d.baseHeight=s,d.width=t,d.height=s,d.format=r,d.generateMipMaps=i,d.samplingMode=l,d.invertY=o,d._compression=h,d.type=c,d._useSRGBBuffer=C,this._doNotHandleContextLost||(d._bufferView=e),d}updateRawTexture(e,t,s,r,i=null,o=0,l=!1){e&&(e._bufferView=t,e.format=s,e.invertY=r,e._compression=i,e.type=o,e._useSRGBBuffer=l)}bindFramebuffer(e,t,s,r,i){this._currentRenderTarget&&this.unBindFramebuffer(this._currentRenderTarget),this._currentRenderTarget=e,this._currentFramebuffer=null,this._cachedViewport&&!i&&this.setViewport(this._cachedViewport,s,r)}unBindFramebuffer(e,t=!1,s){this._currentRenderTarget=null,s&&s(),this._currentFramebuffer=null}createDynamicVertexBuffer(e){const t=new R;return t.references=1,t.capacity=1,t}updateDynamicTexture(e,t,s,r=!1,i){}areAllEffectsReady(){return!0}getError(){return 0}_getUnpackAlignement(){return 1}_unpackFlipY(e){}updateDynamicIndexBuffer(e,t,s=0){}updateDynamicVertexBuffer(e,t,s,r){}_bindTextureDirectly(e,t){return this._boundTexturesCache[this._activeChannel]!==t?(this._boundTexturesCache[this._activeChannel]=t,!0):!1}_bindTexture(e,t){e<0||this._bindTextureDirectly(0,t)}_deleteBuffer(e){}releaseEffects(){}displayLoadingUI(){}hideLoadingUI(){}set loadingUIText(e){}flushFramebuffer(){}_uploadCompressedDataToTextureDirectly(e,t,s,r,i,o=0,l=0){}_uploadDataToTextureDirectly(e,t,s=0,r=0){}_uploadArrayBufferViewToTexture(e,t,s=0,r=0){}_uploadImageToTexture(e,t,s=0,r=0){}}function ne(n,e,t,s,r){return(1-n)*(1-n)*(1-n)*e+3*(1-n)*(1-n)*n*t+3*(1-n)*n*n*s+n*n*n*r}function me(n,e=new A(0,1),t=new A(0,.1),s=new A(0,.1),r=new A(1300,.1)){const i=Math.pow(n/r.x,.333333);return ne(i,e.y,t.y,s.y,r.y)}const ae="textureMerger";function M(n){return"texture"in n}function F(n){return"value"in n}async function Ce(n,e,t){let s=[e.red,e.green,e.blue,e.alpha];e.sharedSampling&&(s=se(`Texture merger '${n}'`,s,a=>a&&M(a)?a.texture:null,()=>({value:1})));const r=[],i=[];for(let a=0;a<4;a++){const _=s[a];if(_)if(M(_)){if(_.sourceChannel<0||_.sourceChannel>3)throw new Error("Source channel must be between 0 and 3 (R, G, B, A)");let g=r.indexOf(_.texture);g===-1&&(g=r.length,r.push(_.texture)),i[a]=g}else if(F(_)){if(_.value<0||_.value>1)throw new Error("Constant value must be between 0.0 and 1.0");i[a]=-1}else throw new Error("Invalid channel input configuration");else i[a]=-1}let o=e.outputSize;if(!o&&r.length>0){let a=0;for(const _ of r){const g=_.getSize(),E=Math.max(g.width,g.height);E>a&&(a=E,o=g.width===g.height?a:g)}}o=o||512;const l=[],h=new Set;for(let a=0;a<4;a++){const _=s[a],g=["RED","GREEN","BLUE","ALPHA"][a];if(_&&M(_)){l.push(`${g}_FROM_TEXTURE`);const E=i[a];h.add(E)}}h.forEach(a=>{l.push(`USE_TEXTURE${a}`)});const c=ie(r),m=!e.sharedSampling||c,C=new Set;if(!m)for(let a=0;a<r.length;a++)oe(r[a])&&(C.add(a),l.push(`TEXTURE${a}_MATRIX`));const d={type:2,format:5,samplingMode:1,generateDepthBuffer:!1,generateMipMaps:!1,shaderLanguage:t.getEngine().isWebGPU?1:0,extraInitializationsAsync:async()=>{t.getEngine().isWebGPU?await Promise.all([y(()=>import("./textureMerger.fragment-D3PFHhgY.js"),__vite__mapDeps([0,1,2]),import.meta.url)]):await Promise.all([y(()=>import("./textureMerger.fragment-S94QEYLr.js"),__vite__mapDeps([3,1,2]),import.meta.url)])},skipSceneRegistration:!0},u=new re(n,o,ae,t,d);u.refreshRate=-1,u.defines=l.length>0?"#define "+l.join(`
#define `)+`
`:"";for(let a=0;a<r.length;a++)u.setTexture(`inputTexture${a}`,r[a]),C.has(a)&&u.setMatrix(`inputTexture${a}Matrix`,r[a].getTextureMatrix());if(r.length>0){const a=r[0],_=r.every(g=>g.wrapU===a.wrapU&&g.wrapV===a.wrapV);e.sharedSampling?(_||z.Warn(`Texture merger '${n}': input textures use different wrap modes; using the wrap modes of the first input texture.`),b(a,u,c)):_&&c&&r.every(g=>g.coordinatesIndex===a.coordinatesIndex)&&b(a,u,!0)}for(let a=0;a<4;a++){const _=s[a],g=["red","green","blue","alpha"][a];if(_&&M(_)){const E=i[a];u.setInt(`${g}TextureIndex`,E),u.setInt(`${g}SourceChannel`,_.sourceChannel)}else{let E;_&&F(_)?E=_.value:E=a===3?1:0,u.setFloat(`${g}ConstantValue`,E)}}return await new Promise((a,_)=>{u.executeWhenReady(()=>{try{u.render(),a(u)}catch(g){_(g instanceof Error?g:new Error(String(g)))}})})}function Ee(n,e){return{texture:n,sourceChannel:e}}function Te(n){return{value:n}}function xe(n,e,t,s){return{red:n,green:e,blue:t,alpha:s}}class p{}p.DEFAULT_COLOR=N.White();p.DEFAULT_WIDTH_ATTENUATED=1;p.DEFAULT_WIDTH=.1;class f{static ConvertPoints(e,t){if(e.length&&Array.isArray(e)&&typeof e[0]=="number")return[e];if(e.length&&Array.isArray(e[0])&&typeof e[0][0]=="number")return e;if(e.length&&!Array.isArray(e[0])&&e[0]instanceof x){const s=[];for(let r=0;r<e.length;r++){const i=e[r];s.push(i.x,i.y,i.z)}return[s]}else if(e.length>0&&Array.isArray(e[0])&&e[0].length>0&&e[0][0]instanceof x){const s=[],r=e;for(const i of r)s.push(i.flatMap(o=>[o.x,o.y,o.z]));return s}else if(e instanceof Float32Array)if(t?.floatArrayStride){const s=[],r=t.floatArrayStride*3;for(let i=0;i<e.length;i+=r){const o=new Array(r);for(let l=0;l<r;l++)o[l]=e[i+l];s.push(o)}return s}else return[Array.from(e)];else if(e.length&&e[0]instanceof Float32Array){const s=[];for(const r of e)s.push(Array.from(r));return s}return[]}static OmitZeroLengthPredicate(e,t,s){const r=[];return t.subtract(e).lengthSquared()>0&&r.push([e,t]),s.subtract(t).lengthSquared()>0&&r.push([t,s]),e.subtract(s).lengthSquared()>0&&r.push([s,e]),r.length===0?null:r}static OmitDuplicatesPredicate(e,t,s,r){const i=[];return f._SearchInPoints(e,t,r)||i.push([e,t]),f._SearchInPoints(t,s,r)||i.push([t,s]),f._SearchInPoints(s,e,r)||i.push([s,e]),i.length===0?null:i}static _SearchInPoints(e,t,s){for(const r of s)for(let i=0;i<r.length;i++)if(r[i]?.equals(e)&&(r[i+1]?.equals(t)||r[i-1]?.equals(t)))return!0;return!1}static MeshesToLines(e,t){const s=[];for(let r=0;r<e.length;r++){const i=e[r],o=i.getVerticesData(H.PositionKind),l=i.getIndices();if(o&&l)for(let h=0,c=0;h<l.length;h++){const m=l[c++]*3,C=l[c++]*3,d=l[c++]*3,u=new x(o[m],o[m+1],o[m+2]),a=new x(o[C],o[C+1],o[C+2]),_=new x(o[d],o[d+1],o[d+2]);if(t){const g=t(u,a,_,s,h,m,i,r,o,l);if(g)for(const E of g)s.push(E)}else s.push([u,a],[a,_],[_,u])}}return s}static ToVector3Array(e){if(Array.isArray(e[0])){const r=[],i=e;for(const o of i){const l=[];for(let h=0;h<o.length;h+=3)l.push(new x(o[h],o[h+1],o[h+2]));r.push(l)}return r}const t=e,s=[];for(let r=0;r<t.length;r+=3)s.push(new x(t[r],t[r+1],t[r+2]));return s}static ToNumberArray(e){return e.flatMap(t=>[t.x,t.y,t.z])}static GetPointsCountInfo(e){const t=new Array(e.length);let s=0;for(let r=e.length;r--;)t[r]=e[r].length/3,s+=t[r];return{total:s,counts:t}}static GetLineLength(e){if(e.length===0)return 0;let t;typeof e[0]=="number"?t=f.ToVector3Array(e):t=e;const s=T.Vector3[0];let r=0;for(let i=0;i<t.length-1;i++){const o=t[i],l=t[i+1];r+=l.subtractToRef(o,s).length()}return r}static GetLineLengthArray(e,t){const s=t?new Float32Array(t,0,e.length/3):new Float32Array(e.length/3);let r=0;for(let i=0,o=e.length/3-1;i<o;i++){let l=e[i*3+0],h=e[i*3+1],c=e[i*3+2];l-=e[i*3+3],h-=e[i*3+4],c-=e[i*3+5];const m=Math.sqrt(l*l+h*h+c*c);r+=m,s[i+1]=r}return s}static SegmentizeSegmentByCount(e,t,s){const r=[],i=t.subtract(e),o=T.Vector3[0];o.setAll(s);const l=T.Vector3[1];i.divideToRef(o,l);let h=e.clone();r.push(h);for(let c=0;c<s;c++)h=h.clone(),r.push(h.addInPlace(l));return r}static SegmentizeLineBySegmentLength(e,t){const s=e[0]instanceof x?f.GetLineSegments(e):typeof e[0]=="number"?f.GetLineSegments(f.ToVector3Array(e)):e,r=[];for(const i of s)if(i.length>t){const o=f.SegmentizeSegmentByCount(i.point1,i.point2,Math.ceil(i.length/t));for(const l of o)r.push(l)}else r.push(i.point1),r.push(i.point2);return r}static SegmentizeLineBySegmentCount(e,t){const s=typeof e[0]=="number"?f.ToVector3Array(e):e,r=f.GetLineLength(s)/t;return f.SegmentizeLineBySegmentLength(s,r)}static GetLineSegments(e){const t=[];for(let s=0;s<e.length-1;s++){const r=e[s],i=e[s+1],o=i.subtract(r).length();t.push({point1:r,point2:i,length:o})}return t}static GetMinMaxSegmentLength(e){const s=f.GetLineSegments(e).sort(r=>r.length);return{min:s[0].length,max:s[s.length-1].length}}static GetPositionOnLineByVisibility(e,t,s,r=!1){const i=t*s;let o=0,l=0;const h=e.length;for(let m=0;m<h;m++){if(i<=o+e[m].length){l=m;break}o+=e[m].length}const c=(i-o)/e[l].length;return e[l].point2.subtractToRef(e[l].point1,T.Vector3[0]),T.Vector3[0].scaleToRef(c,T.Vector3[1]),r||T.Vector3[1].addInPlace(e[l].point1),T.Vector3[1].clone()}static GetCircleLinePoints(e,t,s=0,r=e,i=Math.PI*2/t){const o=[];for(let l=0;l<=t;l++)o.push(new x(Math.cos(l*i)*e,Math.sin(l*i)*r,s));return o}static GetBezierLinePoints(e,t,s,r){return k.CreateQuadraticBezier(e,t,s,r).getPoints().flatMap(i=>[i.x,i.y,i.z])}static GetArrowCap(e,t,s,r,i,o=0,l=0){return{points:[e.clone(),e.add(t.multiplyByFloats(s,s,s))],widths:[r,i,o,l]}}static GetPointsFromText(e,t,s,r,i=0,o=!0){const l=[],h=$(e,t,s,r);for(const c of h){for(const m of c.paths){const C=[],d=m.getPoints();for(const u of d)C.push(u.x,u.y,i);l.push(C)}if(o)for(const m of c.holes){const C=[],d=m.getPoints();for(const u of d)C.push(u.x,u.y,i);l.push(C)}}return l}static Color3toRGBAUint8(e){const t=new Uint8Array(e.length*4);for(let s=0,r=0;s<e.length;s++)t[r++]=e[s].r*255,t[r++]=e[s].g*255,t[r++]=e[s].b*255,t[r++]=255;return t}static CreateColorsTexture(e,t,s,r){const i=r.getEngine().getCaps().maxTextureSize??1,o=t.length>i?i:t.length,l=Math.ceil(t.length/i);l>1&&(t=[...t,...Array(o*l-t.length).fill(t[0])]);const h=f.Color3toRGBAUint8(t),c=new O(h,o,l,v.TEXTUREFORMAT_RGBA,r,!1,!0,s);return c.name=e,c}static PrepareEmptyColorsTexture(e){if(!p.EmptyColorsTexture){const t=new Uint8Array(4);p.EmptyColorsTexture=new O(t,1,1,v.TEXTUREFORMAT_RGBA,e,!1,!1,O.NEAREST_NEAREST),p.EmptyColorsTexture.name="grlEmptyColorsTexture",p.EmptyColorsTexture.onDisposeObservable.addOnce(()=>{p.EmptyColorsTexture=null})}return p.EmptyColorsTexture}static DisposeEmptyColorsTexture(){p.EmptyColorsTexture?.dispose(),p.EmptyColorsTexture=null}static BooleanToNumber(e){return e?1:0}}function ue(n,e){if(n==="vertex"){const t={CUSTOM_VERTEX_DEFINITIONS:`
                attribute float grl_widths;
                #ifdef GREASED_LINE_USE_OFFSETS
                    attribute vec3 grl_offsets;
                #endif
                attribute float grl_colorPointers;
                varying float grlCounters;
                varying float grlColorPointer;

                #ifdef GREASED_LINE_CAMERA_FACING
                    attribute vec4 grl_previousAndSide;
                    attribute vec4 grl_nextAndCounters;

                    vec2 grlFix( vec4 i, float aspect ) {
                        vec2 res = i.xy / i.w;
                        res.x *= aspect;
                        return res;
                    }
                #else
                    attribute vec3 grl_slopes;
                    attribute float grl_counters;
                #endif
                `,CUSTOM_VERTEX_UPDATE_POSITION:`
                #ifdef GREASED_LINE_USE_OFFSETS
                    vec3 grlPositionOffset = grl_offsets;
                #else
                    vec3 grlPositionOffset = vec3(0.);
                #endif

                #ifdef GREASED_LINE_CAMERA_FACING
                    positionUpdated += grlPositionOffset;
                #else
                    positionUpdated = (positionUpdated + grlPositionOffset) + (grl_slopes * grl_widths);
                #endif
                `,CUSTOM_VERTEX_MAIN_END:`
                grlColorPointer = grl_colorPointers;

                #ifdef GREASED_LINE_CAMERA_FACING

                    float grlAspect = grl_aspect_resolution_lineWidth.x;
                    float grlBaseWidth = grl_aspect_resolution_lineWidth.w;

                    vec3 grlPrevious = grl_previousAndSide.xyz;
                    float grlSide = grl_previousAndSide.w;

                    vec3 grlNext = grl_nextAndCounters.xyz;
                    grlCounters = grl_nextAndCounters.w;
                    float grlWidth = grlBaseWidth * grl_widths;
                    
                    vec3 worldDir = normalize(grlNext - grlPrevious);
                    vec3 nearPosition = positionUpdated + (worldDir * 0.01);
                    mat4 grlMatrix = viewProjection * finalWorld;
                    vec4 grlFinalPosition = grlMatrix * vec4(positionUpdated , 1.0);
                    vec4 screenNearPos = grlMatrix * vec4(nearPosition, 1.0);
                    vec2 grlLinePosition = grlFix(grlFinalPosition, grlAspect);
                    vec2 grlLineNearPosition = grlFix(screenNearPos, grlAspect);
                    vec2 grlDir = normalize(grlLineNearPosition - grlLinePosition);

                    vec4 grlNormal = vec4(-grlDir.y, grlDir.x, 0., 1.);

                    #ifdef GREASED_LINE_RIGHT_HANDED_COORDINATE_SYSTEM
                        grlNormal.xy *= -.5 * grlWidth;
                    #else
                        grlNormal.xy *= .5 * grlWidth;
                    #endif

                    grlNormal *= grl_projection;

                    #ifdef GREASED_LINE_SIZE_ATTENUATION
                        grlNormal.xy *= grlFinalPosition.w;
                        grlNormal.xy /= (vec4(grl_aspect_resolution_lineWidth.yz, 0., 1.) * grl_projection).xy;
                    #endif

                    grlFinalPosition.xy += grlNormal.xy * grlSide;
                    gl_Position = grlFinalPosition;

                    vPositionW = vec3(grlFinalPosition);
                #else
                    grlCounters = grl_counters;
                #endif
                `};return e&&(t["!gl_Position\\=viewProjection\\*worldPos;"]="//"),t}return n==="fragment"?{CUSTOM_FRAGMENT_DEFINITIONS:`
                    #ifdef PBR
                         #define grlFinalColor finalColor
                    #else
                         #define grlFinalColor color
                    #endif

                    varying float grlCounters;
                    varying float grlColorPointer;
                    uniform sampler2D grl_colors;
                `,CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR:`
                    float grlColorMode = grl_colorMode_visibility_colorsWidth_useColors.x;
                    float grlVisibility = grl_colorMode_visibility_colorsWidth_useColors.y;
                    float grlColorsWidth = grl_colorMode_visibility_colorsWidth_useColors.z;
                    float grlUseColors = grl_colorMode_visibility_colorsWidth_useColors.w;

                    float grlUseDash = grl_dashOptions.x;
                    float grlDashArray = grl_dashOptions.y;
                    float grlDashOffset = grl_dashOptions.z;
                    float grlDashRatio = grl_dashOptions.w;

                    grlFinalColor.a *= step(grlCounters, grlVisibility);
                    if(grlFinalColor.a == 0.) discard;

                    if(grlUseDash == 1.){
                        grlFinalColor.a *= ceil(mod(grlCounters + grlDashOffset, grlDashArray) - (grlDashArray * grlDashRatio));
                        if (grlFinalColor.a == 0.) discard;
                    }

                    #ifdef GREASED_LINE_HAS_COLOR
                        if (grlColorMode == 0.) {
                            grlFinalColor.rgb = grl_singleColor;
                        } else if (grlColorMode == 1.) {
                            grlFinalColor.rgb += grl_singleColor;
                        } else if (grlColorMode == 2.) {
                            grlFinalColor.rgb *= grl_singleColor;
                        }
                    #else
                        if (grlUseColors == 1.) {
                            #ifdef GREASED_LINE_COLOR_DISTRIBUTION_TYPE_LINE
                                vec4 grlColor = texture2D(grl_colors, vec2(grlCounters, 0.), 0.);
                            #else
                                vec2 lookup = vec2(fract(grlColorPointer / grl_textureSize.x), 1.0 - floor(grlColorPointer / grl_textureSize.x) / max(grl_textureSize.y - 1.0, 1.0));
                                vec4 grlColor = texture2D(grl_colors, lookup, 0.0);
                            #endif
                            if (grlColorMode == 0.) {
                                grlFinalColor = grlColor;
                            } else if (grlColorMode == 1.) {
                                grlFinalColor += grlColor;
                            } else if (grlColorMode == 2.) {
                                grlFinalColor *= grlColor;
                            }
                        }
                    #endif
                `}:null}function he(n,e){if(n==="vertex"){const t={CUSTOM_VERTEX_DEFINITIONS:`
                attribute grl_widths: f32;
                attribute grl_colorPointers: f32;
                varying grlCounters: f32;
                varying grlColorPointer: f32;

                #ifdef GREASED_LINE_USE_OFFSETS
                    attribute grl_offsets: vec3f;   
                #endif

                #ifdef GREASED_LINE_CAMERA_FACING
                    attribute grl_previousAndSide : vec4f;
                    attribute grl_nextAndCounters : vec4f;

                    fn grlFix(i: vec4f, aspect: f32) -> vec2f {
                        var res = i.xy / i.w;
                        res.x *= aspect;
                        return res;
                    }
                #else
                    attribute grl_slopes: f32;
                    attribute grl_counters: f32;
                #endif


                `,CUSTOM_VERTEX_UPDATE_POSITION:`
                #ifdef GREASED_LINE_USE_OFFSETS
                    var grlPositionOffset: vec3f = input.grl_offsets;
                #else
                    var grlPositionOffset = vec3f(0.);
                #endif

                #ifdef GREASED_LINE_CAMERA_FACING
                    positionUpdated += grlPositionOffset;
                #else
                    positionUpdated = (positionUpdated + grlPositionOffset) + (input.grl_slopes * input.grl_widths);
                #endif
                `,CUSTOM_VERTEX_MAIN_END:`
                vertexOutputs.grlColorPointer = input.grl_colorPointers;

                #ifdef GREASED_LINE_CAMERA_FACING

                    let grlAspect: f32 = uniforms.grl_aspect_resolution_lineWidth.x;
                    let grlBaseWidth: f32 = uniforms.grl_aspect_resolution_lineWidth.w;

                    let grlPrevious: vec3f = input.grl_previousAndSide.xyz;
                    let grlSide: f32 = input.grl_previousAndSide.w;

                    let grlNext: vec3f = input.grl_nextAndCounters.xyz;
                    vertexOutputs.grlCounters = input.grl_nextAndCounters.w;

                    let grlWidth: f32 = grlBaseWidth * input.grl_widths;

                    let worldDir: vec3f = normalize(grlNext - grlPrevious);
                    let nearPosition: vec3f = positionUpdated + (worldDir * 0.01);
                    let grlMatrix: mat4x4f = uniforms.viewProjection * finalWorld;
                    let grlFinalPosition: vec4f = grlMatrix * vec4f(positionUpdated, 1.0); 
                    let screenNearPos: vec4f = grlMatrix * vec4(nearPosition, 1.0);
                    let grlLinePosition: vec2f = grlFix(grlFinalPosition, grlAspect);
                    let grlLineNearPosition: vec2f = grlFix(screenNearPos, grlAspect);
                    let grlDir: vec2f = normalize(grlLineNearPosition - grlLinePosition);

                    var grlNormal: vec4f = vec4f(-grlDir.y, grlDir.x, 0.0, 1.0);

                    let grlHalfWidth: f32 = 0.5 * grlWidth;
                    #if defined(GREASED_LINE_RIGHT_HANDED_COORDINATE_SYSTEM)
                        grlNormal.x *= -grlHalfWidth;
                        grlNormal.y *= -grlHalfWidth;
                    #else
                        grlNormal.x *= grlHalfWidth;
                        grlNormal.y *= grlHalfWidth;
                    #endif

                    grlNormal *= uniforms.grl_projection;

                    #if defined(GREASED_LINE_SIZE_ATTENUATION)
                        grlNormal.x *= grlFinalPosition.w;
                        grlNormal.y *= grlFinalPosition.w;

                        let pr = vec4f(uniforms.grl_aspect_resolution_lineWidth.yz, 0.0, 1.0) * uniforms.grl_projection;
                        grlNormal.x /= pr.x;
                        grlNormal.y /= pr.y;
                    #endif

                    vertexOutputs.position = vec4f(grlFinalPosition.xy + grlNormal.xy * grlSide, grlFinalPosition.z, grlFinalPosition.w);
                    vertexOutputs.vPositionW = vertexOutputs.position.xyz;
                
                #else
                    vertexOutputs.grlCounters = input.grl_counters;
                #endif
                `};return e&&(t["!vertexOutputs\\.position\\s=\\sscene\\.viewProjection\\s\\*\\sworldPos;"]="//"),t}return n==="fragment"?{CUSTOM_FRAGMENT_DEFINITIONS:`
                    #ifdef PBR
                         #define grlFinalColor finalColor
                    #else
                         #define grlFinalColor color
                    #endif

                    varying grlCounters: f32;
                    varying grlColorPointer: 32;

                    var grl_colors: texture_2d<f32>;
                    var grl_colorsSampler: sampler;
                `,CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR:`
                    let grlColorMode: f32 = uniforms.grl_colorMode_visibility_colorsWidth_useColors.x;
                    let grlVisibility: f32 = uniforms.grl_colorMode_visibility_colorsWidth_useColors.y;
                    let grlColorsWidth: f32 = uniforms.grl_colorMode_visibility_colorsWidth_useColors.z;
                    let grlUseColors: f32 = uniforms.grl_colorMode_visibility_colorsWidth_useColors.w;

                    let grlUseDash: f32 = uniforms.grl_dashOptions.x;
                    let grlDashArray: f32 = uniforms.grl_dashOptions.y;
                    let grlDashOffset: f32 = uniforms.grl_dashOptions.z;
                    let grlDashRatio: f32 = uniforms.grl_dashOptions.w;

                    grlFinalColor.a *= step(fragmentInputs.grlCounters, grlVisibility);
                    if (grlFinalColor.a == 0.0) {
                        discard;
                    }

                    if (grlUseDash == 1.0) {
                        let dashPosition = (fragmentInputs.grlCounters + grlDashOffset) % grlDashArray;
                        grlFinalColor.a *= ceil(dashPosition - (grlDashArray * grlDashRatio));

                        if (grlFinalColor.a == 0.0) {
                            discard;
                        }
                    }

                    #ifdef GREASED_LINE_HAS_COLOR
                        if (grlColorMode == 0.) {
                            grlFinalColor = vec4f(uniforms.grl_singleColor, grlFinalColor.a);
                        } else if (grlColorMode == 1.) {
                            grlFinalColor += vec4f(uniforms.grl_singleColor, grlFinalColor.a);
                        } else if (grlColorMode == 2.) {
                            grlFinalColor *= vec4f(uniforms.grl_singleColor, grlFinalColor.a);
                        }
                    #else
                        if (grlUseColors == 1.) {
                            #ifdef GREASED_LINE_COLOR_DISTRIBUTION_TYPE_LINE
                                let grlColor: vec4f = textureSample(grl_colors, grl_colorsSampler, vec2f(fragmentInputs.grlCounters, 0.));
                            #else
                                let lookup: vec2f = vec2(fract(fragmentInputs.grlColorPointer / uniforms.grl_textureSize.x), 1.0 - floor(fragmentInputs.grlColorPointer / uniforms.grl_textureSize.x) / max(uniforms.grl_textureSize.y - 1.0, 1.0));
                                let grlColor: vec4f = textureSample(grl_colors, grl_colorsSampler, lookup);
                            #endif
                            if (grlColorMode == 0.) {
                                grlFinalColor = grlColor;
                            } else if (grlColorMode == 1.) {
                                grlFinalColor += grlColor;
                            } else if (grlColorMode == 2.) {
                                grlFinalColor *= grlColor;
                            }
                        }
                    #endif


                `}:null}class fe extends Y{constructor(){super(...arguments),this.GREASED_LINE_HAS_COLOR=!1,this.GREASED_LINE_SIZE_ATTENUATION=!1,this.GREASED_LINE_COLOR_DISTRIBUTION_TYPE_LINE=!1,this.GREASED_LINE_RIGHT_HANDED_COORDINATE_SYSTEM=!1,this.GREASED_LINE_CAMERA_FACING=!0,this.GREASED_LINE_USE_OFFSETS=!1}}class S extends j{isCompatible(e){return!0}constructor(e,t,s){s=s||{color:p.DEFAULT_COLOR};const r=new fe;r.GREASED_LINE_HAS_COLOR=!!s.color&&!s.useColors,r.GREASED_LINE_SIZE_ATTENUATION=s.sizeAttenuation??!1,r.GREASED_LINE_COLOR_DISTRIBUTION_TYPE_LINE=s.colorDistributionType===1,r.GREASED_LINE_RIGHT_HANDED_COORDINATE_SYSTEM=(t??e.getScene()).useRightHandedSystem,r.GREASED_LINE_CAMERA_FACING=s.cameraFacing??!0,super(e,S.GREASED_LINE_MATERIAL_NAME,200,r,!0,!0),this.colorsTexture=null,this._forceGLSL=!1,this._forceGLSL=s?.forceGLSL||S.ForceGLSL,this._scene=t??e.getScene(),this._engine=this._scene.getEngine(),this._cameraFacing=s.cameraFacing??!0,this.visibility=s.visibility??1,this.useDash=s.useDash??!1,this.dashRatio=s.dashRatio??.5,this.dashOffset=s.dashOffset??0,this.width=s.width?s.width:s.sizeAttenuation?p.DEFAULT_WIDTH_ATTENUATED:p.DEFAULT_WIDTH,this._sizeAttenuation=s.sizeAttenuation??!1,this.colorMode=s.colorMode??0,this._color=s.color??null,this.useColors=s.useColors??!1,this._colorsDistributionType=s.colorDistributionType??0,this.colorsSampling=s.colorsSampling??O.NEAREST_NEAREST,this._colors=s.colors??null,this.dashCount=s.dashCount??1,this.resolution=s.resolution??new A(this._engine.getRenderWidth(),this._engine.getRenderHeight()),s.colorsTexture?this.colorsTexture=s.colorsTexture:this._colors?this.colorsTexture=f.CreateColorsTexture(`${e.name}-colors-texture`,this._colors,this.colorsSampling,this._scene):(this._color=this._color??p.DEFAULT_COLOR,f.PrepareEmptyColorsTexture(this._scene)),this._engine.onDisposeObservable.add(()=>{f.DisposeEmptyColorsTexture()})}getAttributes(e){e.push("grl_offsets"),e.push("grl_widths"),e.push("grl_colorPointers"),e.push("grl_counters"),this._cameraFacing?(e.push("grl_previousAndSide"),e.push("grl_nextAndCounters")):e.push("grl_slopes")}getSamplers(e){e.push("grl_colors")}getActiveTextures(e){this.colorsTexture&&e.push(this.colorsTexture)}getUniforms(e=0){const t=[{name:"grl_singleColor",size:3,type:"vec3"},{name:"grl_textureSize",size:2,type:"vec2"},{name:"grl_dashOptions",size:4,type:"vec4"},{name:"grl_colorMode_visibility_colorsWidth_useColors",size:4,type:"vec4"}];return this._cameraFacing&&t.push({name:"grl_projection",size:16,type:"mat4"},{name:"grl_aspect_resolution_lineWidth",size:4,type:"vec4"}),e===1&&t.push({name:"viewProjection",size:16,type:"mat4"}),{ubo:t,vertex:this._cameraFacing&&this._isGLSL(e)?`
                    uniform vec4 grl_aspect_resolution_lineWidth;
                    uniform mat4 grl_projection;
    `:"",fragment:this._isGLSL(e)?`
                    uniform vec4 grl_dashOptions;
                    uniform vec2 grl_textureSize;
                    uniform vec4 grl_colorMode_visibility_colorsWidth_useColors;
                    uniform vec3 grl_singleColor;
    `:""}}get isEnabled(){return!0}bindForSubMesh(e){if(this._cameraFacing){e.updateMatrix("grl_projection",this._scene.getProjectionMatrix()),this._isGLSL(this._material.shaderLanguage)||e.updateMatrix("viewProjection",this._scene.getTransformMatrix());const i=T.Vector4[0];i.x=this._aspect,i.y=this._resolution.x,i.z=this._resolution.y,i.w=this.width,e.updateVector4("grl_aspect_resolution_lineWidth",i)}const t=T.Vector4[0];t.x=f.BooleanToNumber(this.useDash),t.y=this._dashArray,t.z=this.dashOffset,t.w=this.dashRatio,e.updateVector4("grl_dashOptions",t);const s=T.Vector4[1];s.x=this.colorMode,s.y=this.visibility,s.z=this.colorsTexture?this.colorsTexture.getSize().width:0,s.w=f.BooleanToNumber(this.useColors),e.updateVector4("grl_colorMode_visibility_colorsWidth_useColors",s),this._color&&e.updateColor3("grl_singleColor",this._color);const r=this.colorsTexture??p.EmptyColorsTexture;e.setTexture("grl_colors",r),e.updateFloat2("grl_textureSize",r?.getSize().width??1,r?.getSize().height??1)}prepareDefines(e,t,s){e.GREASED_LINE_HAS_COLOR=!!this.color&&!this.useColors,e.GREASED_LINE_SIZE_ATTENUATION=this._sizeAttenuation,e.GREASED_LINE_COLOR_DISTRIBUTION_TYPE_LINE=this._colorsDistributionType===1,e.GREASED_LINE_RIGHT_HANDED_COORDINATE_SYSTEM=t.useRightHandedSystem,e.GREASED_LINE_CAMERA_FACING=this._cameraFacing,e.GREASED_LINE_USE_OFFSETS=!!s.offsets}getClassName(){return S.GREASED_LINE_MATERIAL_NAME}getCustomCode(e,t=0){return this._isGLSL(t)?ue(e,this._cameraFacing):he(e,this._cameraFacing)}dispose(){this.colorsTexture?.dispose(),super.dispose()}get colors(){return this._colors}set colors(e){this.setColors(e)}setColors(e,t=!1,s=!1){const r=this._colors?.length??0;if(this._colors=e,e===null||e.length===0){this.colorsTexture?.dispose();return}if(!(t&&!s))if(this.colorsTexture&&r===e.length&&!s){const i=f.Color3toRGBAUint8(e);this.colorsTexture.update(i)}else this.colorsTexture?.dispose(),this.colorsTexture=f.CreateColorsTexture(`${this._material.name}-colors-texture`,e,this.colorsSampling,this._scene)}updateLazy(){this._colors&&this.setColors(this._colors,!1,!0)}get dashCount(){return this._dashCount}set dashCount(e){this._dashCount=e,this._dashArray=1/e}get sizeAttenuation(){return this._sizeAttenuation}set sizeAttenuation(e){this._sizeAttenuation=e,this.markAllDefinesAsDirty()}get color(){return this._color}set color(e){this.setColor(e)}setColor(e,t=!1){this._color===null&&e!==null||this._color!==null&&e===null?(this._color=e,t||this.markAllDefinesAsDirty()):this._color=e}get colorsDistributionType(){return this._colorsDistributionType}set colorsDistributionType(e){this._colorsDistributionType=e,this.markAllDefinesAsDirty()}get resolution(){return this._resolution}set resolution(e){this._aspect=e.x/e.y,this._resolution=e}serialize(){const e=super.serialize(),t={colorDistributionType:this._colorsDistributionType,colorsSampling:this.colorsSampling,colorMode:this.colorMode,dashCount:this._dashCount,dashOffset:this.dashOffset,dashRatio:this.dashRatio,resolution:this._resolution,sizeAttenuation:this._sizeAttenuation,useColors:this.useColors,useDash:this.useDash,visibility:this.visibility,width:this.width};return this._colors&&(t.colors=this._colors),this._color&&(t.color=this._color),e.greasedLineMaterialOptions=t,e}parse(e,t,s){super.parse(e,t,s);const r=e.greasedLineMaterialOptions;this.colorsTexture?.dispose(),r.color&&this.setColor(r.color,!0),r.colorDistributionType&&(this.colorsDistributionType=r.colorDistributionType),r.colors&&(this.colors=r.colors),r.colorsSampling&&(this.colorsSampling=r.colorsSampling),r.colorMode&&(this.colorMode=r.colorMode),r.useColors&&(this.useColors=r.useColors),r.visibility&&(this.visibility=r.visibility),r.useDash&&(this.useDash=r.useDash),r.dashCount&&(this.dashCount=r.dashCount),r.dashRatio&&(this.dashRatio=r.dashRatio),r.dashOffset&&(this.dashOffset=r.dashOffset),r.width&&(this.width=r.width),r.sizeAttenuation&&(this.sizeAttenuation=r.sizeAttenuation),r.resolution&&(this.resolution=r.resolution),this.colors?this.colorsTexture=f.CreateColorsTexture(`${this._material.name}-colors-texture`,this.colors,this.colorsSampling,t):f.PrepareEmptyColorsTexture(t),this.markAllDefinesAsDirty()}copyTo(e){const t=e;t.colorsTexture?.dispose(),this._colors&&(t.colorsTexture=f.CreateColorsTexture(`${t._material.name}-colors-texture`,this._colors,t.colorsSampling,this._scene)),t.setColor(this.color,!0),t.colorsDistributionType=this.colorsDistributionType,t.colorsSampling=this.colorsSampling,t.colorMode=this.colorMode,t.useColors=this.useColors,t.visibility=this.visibility,t.useDash=this.useDash,t.dashCount=this.dashCount,t.dashRatio=this.dashRatio,t.dashOffset=this.dashOffset,t.width=this.width,t.sizeAttenuation=this.sizeAttenuation,t.resolution=this.resolution,t.markAllDefinesAsDirty()}_isGLSL(e){return e===0||this._forceGLSL}}S.GREASED_LINE_MATERIAL_NAME="GreasedLinePluginMaterial";S.ForceGLSL=!1;let w=!1;function Se(){w||(w=!0,X(`BABYLON.${S.GREASED_LINE_MATERIAL_NAME}`,S))}const ce="GREASED_LINE_USE_OFFSETS";class I extends q{constructor(e,t,s){const r=t.getEngine(),i=r.isWebGPU&&!(s.forceGLSL||I.ForceGLSL),o=["COLOR_DISTRIBUTION_TYPE_LINE 1.","COLOR_DISTRIBUTION_TYPE_SEGMENT 0.","COLOR_MODE_SET 0.","COLOR_MODE_ADD 1.","COLOR_MODE_MULTIPLY 2."];t.useRightHandedSystem&&o.push("GREASED_LINE_RIGHT_HANDED_COORDINATE_SYSTEM");const l=["position","grl_widths","grl_offsets","grl_colorPointers"];s.cameraFacing?(o.push("GREASED_LINE_CAMERA_FACING"),l.push("grl_previousAndSide","grl_nextAndCounters")):(l.push("grl_slopes"),l.push("grl_counters"));const h=["grlColorsWidth","grlUseColors","grlWidth","grlColor","grl_colorModeAndColorDistributionType","grlResolution","grlAspect","grlAizeAttenuation","grlDashArray","grlDashOffset","grlDashRatio","grlUseDash","grlVisibility","grlColors"];if(i||h.push("world","viewProjection","view","projection"),super(e,t,{vertex:"greasedLine",fragment:"greasedLine"},{uniformBuffers:i?["Scene","Mesh"]:void 0,attributes:l,uniforms:h,samplers:i?[]:["grlColors"],defines:o,extraInitializationsAsync:async()=>{i?await Promise.all([y(()=>import("./greasedLine.vertex-D44pfVm8.js"),__vite__mapDeps([4,1,2,5,6,7,8]),import.meta.url),y(()=>import("./greasedLine.fragment-BG-8IHrL.js"),__vite__mapDeps([9,1,2]),import.meta.url)]):await Promise.all([y(()=>import("./greasedLine.vertex-h5iK0iTK.js"),__vite__mapDeps([10,1,2,11,12]),import.meta.url),y(()=>import("./greasedLine.fragment-DE2DFoM1.js"),__vite__mapDeps([13,1,2]),import.meta.url)])},shaderLanguage:i?1:0}),this._color=N.White(),this._colorsDistributionType=0,this._colorsTexture=null,s=s||{color:p.DEFAULT_COLOR},this.visibility=s.visibility??1,this.useDash=s.useDash??!1,this.dashRatio=s.dashRatio??.5,this.dashOffset=s.dashOffset??0,this.dashCount=s.dashCount??1,this.width=s.width?s.width:s.sizeAttenuation&&s.cameraFacing?p.DEFAULT_WIDTH_ATTENUATED:p.DEFAULT_WIDTH,this.sizeAttenuation=s.sizeAttenuation??!1,this.color=s.color??N.White(),this.useColors=s.useColors??!1,this.colorsDistributionType=s.colorDistributionType??0,this.colorsSampling=s.colorsSampling??O.NEAREST_NEAREST,this.colorMode=s.colorMode??0,this._colors=s.colors??null,this._cameraFacing=s.cameraFacing??!0,this.resolution=s.resolution??new A(r.getRenderWidth(),r.getRenderHeight()),s.colorsTexture?this.colorsTexture=s.colorsTexture:this._colors?this.colorsTexture=f.CreateColorsTexture(`${this.name}-colors-texture`,this._colors,this.colorsSampling,t):(this._color=this._color??p.DEFAULT_COLOR,this.colorsTexture=f.PrepareEmptyColorsTexture(t)),i){const c=new Z;c.setParameters(),c.samplingMode=this.colorsSampling,this.setTextureSampler("grlColorsSampler",c)}r.onDisposeObservable.add(()=>{f.DisposeEmptyColorsTexture()})}dispose(){this._colorsTexture&&this._colorsTexture!==p.EmptyColorsTexture&&this._colorsTexture.dispose(),super.dispose()}_setColorModeAndColorDistributionType(){this.setVector2("grl_colorModeAndColorDistributionType",new A(this._colorMode,this._colorsDistributionType))}updateLazy(){this._colors&&this.setColors(this._colors,!1,!0)}get colors(){return this._colors}set colors(e){this.setColors(e)}setColors(e,t=!1,s=!1){const r=this._colors?.length??0;if(this._colors=e,e===null||e.length===0){this._colorsTexture&&this._colorsTexture!==p.EmptyColorsTexture&&this._colorsTexture.dispose();const i=this.getScene();i&&(this.colorsTexture=f.PrepareEmptyColorsTexture(i));return}if(!(t&&!s))if(this._colorsTexture&&r===e.length&&!s){const i=f.Color3toRGBAUint8(e);this._colorsTexture.update(i)}else this._colorsTexture&&this._colorsTexture!==p.EmptyColorsTexture&&this._colorsTexture.dispose(),this.colorsTexture=f.CreateColorsTexture(`${this.name}-colors-texture`,e,this.colorsSampling,this.getScene())}get colorsTexture(){return this._colorsTexture??null}set colorsTexture(e){this._colorsTexture=e,this.setFloat("grlColorsWidth",this._colorsTexture.getSize().width),this.setTexture("grlColors",this._colorsTexture)}get width(){return this._width}set width(e){this._width=e,this.setFloat("grlWidth",e)}get useColors(){return this._useColors}set useColors(e){this._useColors=e,this.setFloat("grlUseColors",f.BooleanToNumber(e))}get colorsSampling(){return this._colorsSampling}set colorsSampling(e){this._colorsSampling=e}get visibility(){return this._visibility}set visibility(e){this._visibility=e,this.setFloat("grlVisibility",e)}get useDash(){return this._useDash}set useDash(e){this._useDash=e,this.setFloat("grlUseDash",f.BooleanToNumber(e))}get dashOffset(){return this._dashOffset}set dashOffset(e){this._dashOffset=e,this.setFloat("grlDashOffset",e)}get dashRatio(){return this._dashRatio}set dashRatio(e){this._dashRatio=e,this.setFloat("grlDashRatio",e)}get dashCount(){return this._dashCount}set dashCount(e){this._dashCount=e,this._dashArray=1/e,this.setFloat("grlDashArray",this._dashArray)}get sizeAttenuation(){return this._sizeAttenuation}set sizeAttenuation(e){this._sizeAttenuation=e,this.setFloat("grlSizeAttenuation",f.BooleanToNumber(e))}get color(){return this._color}set color(e){this.setColor(e)}setColor(e){e=e??p.DEFAULT_COLOR,this._color=e,this.setColor3("grlColor",e)}get colorsDistributionType(){return this._colorsDistributionType}set colorsDistributionType(e){this._colorsDistributionType=e,this._setColorModeAndColorDistributionType()}get colorMode(){return this._colorMode}set colorMode(e){this._colorMode=e,this._setColorModeAndColorDistributionType()}get resolution(){return this._resolution}set resolution(e){this._resolution=e,this.setVector2("grlResolution",e),this.setFloat("grlAspect",e.x/e.y)}serialize(){const e=super.serialize(),t={colorDistributionType:this._colorsDistributionType,colorsSampling:this._colorsSampling,colorMode:this._colorMode,color:this._color,dashCount:this._dashCount,dashOffset:this._dashOffset,dashRatio:this._dashRatio,resolution:this._resolution,sizeAttenuation:this._sizeAttenuation,useColors:this._useColors,useDash:this._useDash,visibility:this._visibility,width:this._width,cameraFacing:this._cameraFacing};return this._colors&&(t.colors=this._colors),e.greasedLineMaterialOptions=t,e}parse(e,t,s){const r=e.greasedLineMaterialOptions;this._colorsTexture?.dispose(),r.color&&(this.color=r.color),r.colorDistributionType&&(this.colorsDistributionType=r.colorDistributionType),r.colorsSampling&&(this.colorsSampling=r.colorsSampling),r.colorMode&&(this.colorMode=r.colorMode),r.useColors&&(this.useColors=r.useColors),r.visibility&&(this.visibility=r.visibility),r.useDash&&(this.useDash=r.useDash),r.dashCount&&(this.dashCount=r.dashCount),r.dashRatio&&(this.dashRatio=r.dashRatio),r.dashOffset&&(this.dashOffset=r.dashOffset),r.width&&(this.width=r.width),r.sizeAttenuation&&(this.sizeAttenuation=r.sizeAttenuation),r.resolution&&(this.resolution=r.resolution),r.colors?this.colorsTexture=f.CreateColorsTexture(`${this.name}-colors-texture`,r.colors,this.colorsSampling,this.getScene()):this.colorsTexture=f.PrepareEmptyColorsTexture(t),this._cameraFacing=r.cameraFacing??!0,this.setDefine("GREASED_LINE_CAMERA_FACING",this._cameraFacing)}}I.ForceGLSL=!1;K();var P;(function(n){n[n.POINTS_MODE_POINTS=0]="POINTS_MODE_POINTS",n[n.POINTS_MODE_PATHS=1]="POINTS_MODE_PATHS"})(P||(P={}));var B;(function(n){n[n.FACES_MODE_SINGLE_SIDED=0]="FACES_MODE_SINGLE_SIDED",n[n.FACES_MODE_SINGLE_SIDED_NO_BACKFACE_CULLING=1]="FACES_MODE_SINGLE_SIDED_NO_BACKFACE_CULLING",n[n.FACES_MODE_DOUBLE_SIDED=2]="FACES_MODE_DOUBLE_SIDED"})(B||(B={}));var U;(function(n){n[n.AUTO_DIRECTIONS_FROM_FIRST_SEGMENT=0]="AUTO_DIRECTIONS_FROM_FIRST_SEGMENT",n[n.AUTO_DIRECTIONS_FROM_ALL_SEGMENTS=1]="AUTO_DIRECTIONS_FROM_ALL_SEGMENTS",n[n.AUTO_DIRECTIONS_ENHANCED=2]="AUTO_DIRECTIONS_ENHANCED",n[n.AUTO_DIRECTIONS_FACE_TO=3]="AUTO_DIRECTIONS_FACE_TO",n[n.AUTO_DIRECTIONS_NONE=99]="AUTO_DIRECTIONS_NONE"})(U||(U={}));class Ae extends Q{constructor(e,t,s){super(e,t,null,null,!1,!1),this.name=e,this._options=s,this._lazy=!1,this._updatable=!1,this._engine=t.getEngine(),this._lazy=s.lazy??!1,this._updatable=s.updatable??!1,this._vertexPositions=[],this._indices=[],this._uvs=[],this._points=[],this._colorPointers=s.colorPointers??[],this._widths=s.widths??new Array(s.points.length).fill(1)}getClassName(){return"GreasedLineMesh"}_updateWidthsWithValue(e){let t=0;for(const r of this._points)t+=r.length;const s=t/3*2-this._widths.length;for(let r=0;r<s;r++)this._widths.push(e)}updateLazy(){this._setPoints(this._points),this._options.colorPointers||this._updateColorPointers(),this._createVertexBuffers(this._options.ribbonOptions?.smoothShading),!this.doNotSyncBoundingInfo&&this.refreshBoundingInfo(),this.greasedLineMaterial?.updateLazy()}addPoints(e,t){for(const s of e)this._points.push(s);this._lazy||this.setPoints(this._points,t)}dispose(e,t=!1){super.dispose(e,t)}isLazy(){return this._lazy}get uvs(){return this._uvs}set uvs(e){this._uvs=e instanceof Float32Array?e:new Float32Array(e),this._createVertexBuffers()}get offsets(){return this._offsets}set offsets(e){this.material instanceof I&&this.material.setDefine(ce,e?.length>0),this._offsets=e,this._offsetsBuffer?this._offsetsBuffer.update(e):this._createOffsetsBuffer(e)}get widths(){return this._widths}set widths(e){this._widths=e,this._lazy||this._widthsBuffer&&this._widthsBuffer.update(e)}get colorPointers(){return this._colorPointers}set colorPointers(e){this._colorPointers=e,this._lazy||this._colorPointersBuffer&&this._colorPointersBuffer.update(e)}get greasedLineMaterial(){if(this.material&&this.material instanceof I)return this.material;const e=this.material?.pluginManager?.getPlugin(S.GREASED_LINE_MATERIAL_NAME);if(e)return e}get points(){const e=[];return J.DeepCopy(this._points,e),e}setPoints(e,t){this._points=f.ConvertPoints(e,t?.pointsOptions??this._options.pointsOptions),this._updateWidths(),t?.colorPointers||this._updateColorPointers(),this._setPoints(this._points,t)}_initGreasedLine(){this._vertexPositions=[],this._indices=[],this._uvs=[]}_createLineOptions(){return{points:this._points,colorPointers:this._colorPointers,lazy:this._lazy,updatable:this._updatable,uvs:this._uvs,widths:this._widths,ribbonOptions:this._options.ribbonOptions}}serialize(e){super.serialize(e),e.type=this.getClassName(),e.lineOptions=this._createLineOptions()}_createVertexBuffers(e=!1){const t=new L;return t.positions=this._vertexPositions,t.indices=this._indices,t.uvs=this._uvs,e&&(t.normals=[],L.ComputeNormals(this._vertexPositions,this._indices,t.normals)),t.applyToMesh(this,this._options.updatable),t}_createOffsetsBuffer(e){const t=this._scene.getEngine(),s=new ee(t,e,this._updatable,3);this.setVerticesBuffer(s.createVertexBuffer("grl_offsets",0,3)),this._offsetsBuffer=s}}te();export{Te as C,Ae as G,fe as M,pe as N,Se as R,me as S,f as a,p as b,S as c,I as d,xe as e,Ee as f,U as g,B as h,P as i,ce as j,Ce as k,le as l};
