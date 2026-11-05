import{b6 as e}from"./index-Co7RwRrn.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-DDzXTNik.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-oVsvmYVz.js";import{l}from"./logDepthFragment-Cm3pIyZg.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-Dulvf8kc.js";import"./objectIdFunctions-I9JaHcMJ.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
