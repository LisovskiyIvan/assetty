import{b6 as e}from"./index-CR91ZdlI.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-CJI6pkll.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-CKF_-55_.js";import{l}from"./logDepthFragment-6rqYDg4L.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-DwwIUDok.js";import"./objectIdFunctions-CGfMr1ir.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
uniform vec4 color;
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const c=[a,i,l,t];for(const r of c)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const h={name:o,shader:n};export{h as linePixelShader};
