import{b6 as e}from"./index-CmAuwD34.js";import{helperFunctions as n}from"./helperFunctions-CF435IEz.js";const r="iblScaledLuminancePixelShader",i=`precision highp sampler2D;precision highp samplerCube;
#include<helperFunctions>
varying vec2 vUV;
#ifdef IBL_USE_CUBE_MAP
uniform samplerCube iblSource;
#else
uniform sampler2D iblSource;
#endif
uniform int iblWidth;uniform int iblHeight;float fetchLuminance(vec2 coords) {
#ifdef IBL_USE_CUBE_MAP
vec3 direction=equirectangularToCubemapDirection(coords);vec3 color=textureCubeLodEXT(iblSource,direction,0.0).rgb;
#else
vec3 color=textureLod(iblSource,coords,0.0).rgb;
#endif
return dot(color,LuminanceEncodeApprox);}
void main(void) {float deform=sin(vUV.y*PI);float luminance=fetchLuminance(vUV);gl_FragColor=vec4(vec3(deform*luminance),1.0);}`;e.ShadersStore[r]||(e.ShadersStore[r]=i);const c=[n];for(const o of c)e.IncludesShadersStore[o.name]||(e.IncludesShadersStore[o.name]=o.shader);const t={name:r,shader:i};export{t as iblScaledLuminancePixelShader};
