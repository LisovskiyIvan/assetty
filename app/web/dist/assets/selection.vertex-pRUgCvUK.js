import{b6 as e}from"./index-CramQklb.js";import{b as n,a as r,c as o,d}from"./bakedVertexAnimation-dEAuWn_y.js";import{m as s,a as f,b as l,c}from"./morphTargetsVertex-S2nbdi2M.js";import{clipPlaneVertexDeclaration as u}from"./clipPlaneVertexDeclaration-DLK7dc0Q.js";import{i as m}from"./instancesDeclaration-RuHj5KSp.js";import{i as v}from"./instancesVertex-Z71VK4-E.js";import{clipPlaneVertex as V}from"./clipPlaneVertex-DXWvCcP-.js";const t="selectionVertexShader",a=`attribute vec3 position;
#ifdef INSTANCES
attribute float instanceSelectionId;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef STORE_CAMERASPACE_Z
uniform mat4 view;
#else
uniform vec2 depthValues;
#endif
#ifdef INSTANCES
flat varying float vSelectionId;
#endif
#ifdef STORE_CAMERASPACE_Z
varying float vViewPosZ;
#else
varying float vDepthMetric;
#endif
#ifdef ALPHATEST
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);gl_Position=viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#ifdef STORE_CAMERASPACE_Z
vViewPosZ=(view*worldPos).z;
#else
#ifdef USE_REVERSE_DEPTHBUFFER
vDepthMetric=((-gl_Position.z+depthValues.x)/(depthValues.y));
#else
vDepthMetric=((gl_Position.z+depthValues.x)/(depthValues.y));
#endif
#endif
#ifdef INSTANCES
vSelectionId=instanceSelectionId;
#endif
#include<clipPlaneVertex>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[t]||(e.ShadersStore[t]=a);const p=[n,r,s,f,u,m,l,c,v,o,d,V];for(const i of p)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const U={name:t,shader:a};export{U as selectionVertexShader};
