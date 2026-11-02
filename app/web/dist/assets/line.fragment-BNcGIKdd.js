import{b6 as e}from"./index-DwYVRG0U.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-CTT-PgKM.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-2OBpBU7x.js";import{l}from"./logDepthFragment--DB0nbTg.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-r4rZtMcD.js";import"./objectIdFunctions-DZXusK9E.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
