import{b6 as e}from"./index-B8E16sa6.js";import{b as o,a as r,c as n,d}from"./bakedVertexAnimation-BRd9Z2Oh.js";import{m as l,a as s,b as c,c as f}from"./morphTargetsVertex-pp4YK7_E.js";import{clipPlaneVertexDeclaration as m}from"./clipPlaneVertexDeclaration-mPRr2ovy.js";import{i as u}from"./instancesDeclaration-IVno1M_0.js";import{logDepthDeclaration as p}from"./logDepthDeclaration-D-UoWrI3.js";import{i as V}from"./instancesVertex-BSlV-wHh.js";import{clipPlaneVertex as v}from"./clipPlaneVertex-hX3Z9xbU.js";import{l as x}from"./logDepthVertex-yVY6Bv3v.js";const i="outlineVertexShader",a=`attribute vec3 position;attribute vec3 normal;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
uniform float offset;
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef ALPHATEST
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void)
{vec3 positionUpdated=position;vec3 normalUpdated=normal;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
vec3 offsetPosition=positionUpdated+(normalUpdated*offset);
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(offsetPosition,1.0);gl_Position=viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
}
`;e.ShadersStore[i]||(e.ShadersStore[i]=a);const h=[o,r,l,s,m,u,p,c,f,V,n,d,v,x];for(const t of h)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);const E={name:i,shader:a};export{E as outlineVertexShader};
