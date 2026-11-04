import{b6 as e}from"./index-BFnQdIYp.js";import{clipPlaneFragmentDeclaration as o}from"./clipPlaneFragmentDeclaration-CcY86FEu.js";import{logDepthDeclaration as a}from"./logDepthDeclaration-CYGa7_Mv.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-BV_xXl-v.js";import{l}from"./logDepthFragment-BcxSYmwO.js";import"./objectIdFunctions-C-4xayOY.js";const i="outlinePixelShader",n=`#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
uniform vec4 color;
#ifdef ALPHATEST
varying vec2 vUV;uniform sampler2D diffuseSampler;
#endif
#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#ifdef ALPHATEST
if (texture2D(diffuseSampler,vUV).a<0.4)
discard;
#endif
#include<logDepthFragment>
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[i]||(e.ShadersStore[i]=n);const d=[o,a,t,l];for(const r of d)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const g={name:i,shader:n};export{g as outlinePixelShader};
